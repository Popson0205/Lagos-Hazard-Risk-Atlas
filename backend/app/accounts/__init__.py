"""Accounts, the Data Management Portal and saved items (see routes.py)."""
import logging
import threading

from fastapi import HTTPException, status

from app.database import Base, engine

from .models import DatasetRecord, SavedItem, User, UserAvatar
from .routes import auth_router, avatar_router, items_router, records_router

log = logging.getLogger(__name__)

__all__ = ["auth_router", "avatar_router", "records_router", "items_router", "init_tables", "ensure_tables"]

_ready = False
_lock = threading.Lock()


def init_tables() -> bool:
    """Create the account tables if they don't exist yet. Only touches these
    account tables, never the hazard catalogue. Returns True once they exist."""
    global _ready
    if _ready:
        return True
    with _lock:
        if _ready:
            return True
        try:
            Base.metadata.create_all(
                engine, tables=[User.__table__, DatasetRecord.__table__, SavedItem.__table__, UserAvatar.__table__]
            )
            _ready = True
            log.info("Account tables are ready.")
        except Exception as exc:  # DB down at boot shouldn't take the public map down too
            log.warning("Could not create account tables yet (will retry on next request): %s", exc)
    return _ready


def ensure_tables() -> None:
    """Router dependency: if the database was unavailable when the app
    started (e.g. a paused Supabase project), create the tables on the first
    account request instead of failing every sign-up until a restart."""
    if not init_tables():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Accounts aren't available yet because the database couldn't be prepared. Try again in a minute.",
        )
