import logging
import os

import bcrypt as bcrypt_lib
import psycopg2
import psycopg2.extras
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.routers.auth import require_admin, get_current_user, effective_permissions, PERMISSION_KEYS

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["users"])


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def ensure_user_type_column() -> None:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                ALTER TABLE users ADD COLUMN IF NOT EXISTS
                user_type TEXT NOT NULL DEFAULT 'employee'
                CHECK (user_type IN ('employee','advisor','partner','contractor','other'))
            """)
        conn.commit()
    finally:
        conn.close()


class UserCreate(BaseModel):
    email: str
    full_name: str
    title: str | None = None
    role: str = "viewer"
    password: str


class UserUpdate(BaseModel):
    full_name: str | None = None
    title: str | None = None
    role: str | None = None
    is_active: bool | None = None
    user_type: str | None = None
    permissions: dict | None = None


class PasswordReset(BaseModel):
    new_password: str


def _row_to_user(row: dict) -> dict:
    overrides = row.get("permissions") or {}
    role = row.get("role") or "viewer"
    return {
        "user_id": str(row["user_id"]),
        "email": row["email"],
        "name": row.get("name"),
        "full_name": row.get("full_name"),
        "title": row.get("title"),
        "role": role,
        "user_type": row.get("user_type", "employee"),
        "is_active": row.get("is_active", True),
        "last_login": row["last_login"].isoformat() if row.get("last_login") else None,
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        "permissions": overrides,                               # raw overrides
        "effective_permissions": effective_permissions(role, overrides),  # merged
    }


@router.get("/me")
def get_me(request: Request):
    """Return current user's profile, role, and effective permissions."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT user_id, email, name, full_name, title, role, user_type, is_active, last_login, created_at, permissions "
                "FROM users WHERE email = %s",
                (user["email"],),
            )
            row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    return _row_to_user(dict(row))


@router.get("")
def list_users(request: Request):
    """List all users with effective permissions. Admin only."""
    require_admin(request)

    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT user_id, email, name, full_name, title, role, user_type, is_active, last_login, created_at, permissions "
                "FROM users ORDER BY role, email"
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    return [_row_to_user(dict(r)) for r in rows]


@router.post("", status_code=201)
def create_user(body: UserCreate, request: Request):
    """Create a new user. Admin only."""
    require_admin(request)

    if body.role not in ("admin", "scientist", "viewer"):
        raise HTTPException(status_code=400, detail="Invalid role")

    hashed = bcrypt_lib.hashpw(body.password.encode(), bcrypt_lib.gensalt()).decode()

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    """INSERT INTO users (email, hashed_password, name, full_name, title, role, is_active)
                       VALUES (%s, %s, %s, %s, %s, %s, true)
                       RETURNING user_id""",
                    (
                        body.email.lower().strip(),
                        hashed,
                        body.full_name,
                        body.full_name,
                        body.title,
                        body.role,
                    ),
                )
                conn.commit()
                user_id = cur.fetchone()[0]
            except psycopg2.errors.UniqueViolation:
                conn.rollback()
                raise HTTPException(status_code=409, detail="Email already exists")
    finally:
        conn.close()

    return {"user_id": str(user_id), "email": body.email, "role": body.role}


@router.patch("/{user_id}")
def update_user(user_id: str, body: UserUpdate, request: Request):
    """Update user fields and/or per-user permission overrides. Admin only."""
    require_admin(request)

    if body.role is not None and body.role not in ("admin", "scientist", "viewer"):
        raise HTTPException(status_code=400, detail="Invalid role")

    # Validate permission keys
    if body.permissions is not None:
        invalid = [k for k in body.permissions if k not in PERMISSION_KEYS]
        if invalid:
            raise HTTPException(status_code=400, detail=f"Unknown permission keys: {invalid}")

    fields = []
    values = []
    if body.full_name is not None:
        fields += ["full_name = %s", "name = %s"]
        values += [body.full_name, body.full_name]
    if body.title is not None:
        fields.append("title = %s")
        values.append(body.title)
    if body.role is not None:
        fields.append("role = %s")
        values.append(body.role)
    if body.is_active is not None:
        fields.append("is_active = %s")
        values.append(body.is_active)
    if body.user_type is not None:
        if body.user_type not in ("employee", "advisor", "partner", "contractor", "other"):
            raise HTTPException(status_code=400, detail="Invalid user_type")
        fields.append("user_type = %s")
        values.append(body.user_type)
    if body.permissions is not None:
        import json
        fields.append("permissions = %s")
        values.append(json.dumps(body.permissions))

    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    values.append(user_id)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE users SET {', '.join(fields)} WHERE user_id = %s RETURNING user_id",
                values,
            )
            conn.commit()
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="User not found")
    finally:
        conn.close()

    return {"ok": True}


@router.post("/{user_id}/reset-password")
def reset_password(user_id: str, body: PasswordReset, request: Request):
    """Reset a user's password. Admin only."""
    require_admin(request)

    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    hashed = bcrypt_lib.hashpw(body.new_password.encode(), bcrypt_lib.gensalt()).decode()

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET hashed_password = %s WHERE user_id = %s RETURNING user_id",
                (hashed, user_id),
            )
            conn.commit()
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="User not found")
    finally:
        conn.close()

    return {"ok": True}


@router.delete("/{user_id}")
def delete_user(user_id: str, request: Request):
    """Hard-delete a user. Admin only. Cannot delete yourself."""
    require_admin(request)

    current = get_current_user(request)
    if current and current.get("user_id") == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE user_id = %s RETURNING user_id", (user_id,))
            conn.commit()
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="User not found")
    finally:
        conn.close()

    return {"ok": True}
