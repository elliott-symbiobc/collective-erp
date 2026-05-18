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
    "contacts",       # Contacts & CRM
    "projects",       # Projects & task management
    # Operations
    "protocols",      # Protocol / SOP bank
    "notebook",       # Notebook (view & write)
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
    "user": {
        # Core
        "contacts": True, "projects": True,
        # Operations
        "protocols": True, "notebook": True,
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
        # Core
        "contacts": False, "projects": True,
        # Operations — viewing protocols is fine
        "protocols": True, "notebook": False,
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


def require_user_or_admin(request: Request) -> dict:
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user["role"] in ("admin", "user"):
        return user
    # Check any lab-relevant permission
    overrides = _get_user_permissions_from_db(user.get("user_id", ""))
    perms = effective_permissions(user["role"], overrides)
    core_perms = ["contacts", "projects", "protocols", "notebook", "invoices"]
    if any(perms.get(k) for k in core_perms):
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
