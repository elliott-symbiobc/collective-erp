import logging
import os

import bcrypt as bcrypt_lib
import psycopg2
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# ── Permission definitions ────────────────────────────────────────────────────

PERMISSION_KEYS = [
    # Core modules
    "analyses",       # View & create BioSTEAM analyses
    "contacts",       # Contacts, CRM, Advisors, Clients
    "projects",       # Projects & task management
    # Lab
    "literature",     # Literature library (view papers)
    "queue_upload",   # Upload papers to review queue
    "queue_approve",  # Approve / reject queue items
    "log_runs",       # Log fermentation runs
    "strains",        # Strains, genome annotation
    "enzymes",        # Enzyme database
    "protocols",      # Protocol bank
    "notebook",       # Lab notebook (view & write)
    # Science
    "model",          # ML model, predictions, SHAP
    "model_retrain",  # Trigger retraining & AI jobs
    "compounds",      # Compound discovery
    "explore",        # AI exploration
    # Finance
    "view_fpa",       # View FP&A dashboard
    "edit_fpa",       # Edit financial model & integrations
    # Admin
    "manage_users",   # User management & admin panel
    "dev_mode",       # Developer mode & debug tools
    # Notes
    "notes",          # Meeting notes with recording & AI analysis
    # Invoices
    "invoices",       # Create, view & manage invoices
]

ROLE_DEFAULTS: dict[str, dict[str, bool]] = {
    "admin": {k: True for k in PERMISSION_KEYS},
    "scientist": {
        # Core
        "analyses": True, "contacts": True, "projects": True,
        # Lab
        "literature": True, "queue_upload": True, "queue_approve": True,
        "log_runs": True, "strains": True, "enzymes": True,
        "protocols": True, "notebook": True,
        # Science
        "model": True, "model_retrain": True, "compounds": True, "explore": True,
        # Finance — off by default
        "view_fpa": False, "edit_fpa": False,
        # Admin — off by default
        "manage_users": False, "dev_mode": True,
        # Notes
        "notes": True,
        # Invoices
        "invoices": True,
    },
    "viewer": {
        # Core — analyses and projects visible to viewers
        "analyses": True, "contacts": False, "projects": True,
        # Lab — most off; viewing library, strains, enzymes, protocols is fine
        "literature": True, "queue_upload": False, "queue_approve": False,
        "log_runs": False, "strains": True, "enzymes": True,
        "protocols": True, "notebook": False,
        # Science — viewing is fine
        "model": True, "model_retrain": False, "compounds": True, "explore": True,
        # Finance & admin — off
        "view_fpa": False, "edit_fpa": False,
        "manage_users": False, "dev_mode": False,
        # Notes — off for viewers
        "notes": False,
        # Invoices — off for viewers
        "invoices": False,
    },
}


def effective_permissions(role: str, overrides: dict) -> dict[str, bool]:
    """Merge role defaults with per-user overrides."""
    base = ROLE_DEFAULTS.get(role, ROLE_DEFAULTS["viewer"]).copy()
    for key in PERMISSION_KEYS:
        if key in overrides:
            base[key] = bool(overrides[key])
    return base


# ── Login / session helpers ───────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    user_id: str
    email: str
    name: str | None
    role: str


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest):
    """Validate credentials and return user record.

    Called by NextAuth CredentialsProvider authorize().
    Returns 401 on invalid credentials — never reveals which field was wrong.
    """
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id, email, hashed_password, name, role FROM users WHERE email = %s AND is_active = true",
            (body.email.lower().strip(),),
        )
        row = cur.fetchone()
        cur.close()
    finally:
        conn.close()

    if row is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user_id, email, hashed, name, role = row
    try:
        valid = bcrypt_lib.checkpw(body.password.encode(), hashed.encode())
    except Exception:
        valid = False

    if not valid:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    logger.info("Login OK: %s (role=%s)", email, role)
    return LoginResponse(user_id=str(user_id), email=email, name=name, role=role or "viewer")


def get_current_user(request: Request) -> dict | None:
    """Extract authenticated user from injected headers (set by Next.js proxy)."""
    email = request.headers.get("X-User-Email")
    role = request.headers.get("X-User-Role", "viewer")
    user_id = request.headers.get("X-User-Id")
    if not email:
        return None
    return {"email": email, "role": role, "user_id": user_id}


def _get_user_permissions_from_db(user_id: str) -> dict:
    """Fetch stored permission overrides for a user from DB."""
    try:
        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        try:
            cur = conn.cursor()
            cur.execute("SELECT permissions FROM users WHERE user_id = %s", (user_id,))
            row = cur.fetchone()
            cur.close()
        finally:
            conn.close()
        return row[0] if row and row[0] else {}
    except Exception:
        return {}


def require_admin(request: Request) -> dict:
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user["role"] == "admin":
        return user
    # Allow users with manage_users permission override
    overrides = _get_user_permissions_from_db(user.get("user_id", ""))
    perms = effective_permissions(user["role"], overrides)
    if not perms.get("manage_users", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def require_scientist_or_admin(request: Request) -> dict:
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user["role"] in ("admin", "scientist"):
        return user
    # Check any lab-relevant permission
    overrides = _get_user_permissions_from_db(user.get("user_id", ""))
    perms = effective_permissions(user["role"], overrides)
    lab_perms = ["queue_upload", "queue_approve", "log_runs", "strains", "protocols", "notebook", "model_retrain"]
    if any(perms.get(k) for k in lab_perms):
        return user
    raise HTTPException(status_code=403, detail="Scientist or admin access required")


def require_fpa(request: Request) -> dict:
    """Require FP&A access: admin role, or view_fpa permission override."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user["role"] == "admin":
        return user
    overrides = _get_user_permissions_from_db(user.get("user_id", ""))
    perms = effective_permissions(user["role"], overrides)
    if not perms.get("view_fpa", False):
        raise HTTPException(status_code=403, detail="FP&A access required")
    return user
