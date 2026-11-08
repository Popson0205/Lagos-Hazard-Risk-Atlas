"""
Password hashing and bearer tokens using only the standard library, so the
auth layer adds no new dependencies to an image that already carries GDAL.

Tokens are `base64url(json payload).base64url(hmac-sha256)`, signed with
SECRET_KEY. If SECRET_KEY isn't set, a key is derived from DATABASE_URL so
every worker process (and every restart) agrees on it; set SECRET_KEY in
production so rotating it is a deliberate act.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db

from .models import User

_PBKDF2_ITERATIONS = 240_000
TOKEN_TTL_SHORT = 12 * 3600  # one working day
TOKEN_TTL_LONG = 30 * 24 * 3600  # "Remember this device for 30 days"


def _secret() -> bytes:
    settings = get_settings()
    if settings.secret_key:
        return settings.secret_key.encode()
    return hashlib.sha256(("atlas-token:" + settings.database_url).encode()).digest()


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt_hex, digest_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations))
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def create_token(user_id: int, remember: bool = False) -> str:
    payload = {"uid": user_id, "exp": int(time.time()) + (TOKEN_TTL_LONG if remember else TOKEN_TTL_SHORT)}
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    sig = _b64(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def decode_token(token: str) -> int | None:
    try:
        body, sig = token.split(".")
        expected = _b64(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(_unb64(body))
        if int(payload.get("exp", 0)) < time.time():
            return None
        return int(payload["uid"])
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return None


_bearer = HTTPBearer(auto_error=False)


def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue.")
    uid = decode_token(creds.credentials)
    user = db.get(User, uid) if uid is not None else None
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session has expired. Sign in again.")
    return user


def is_admin(user: User) -> bool:
    return user.role == "admin"
