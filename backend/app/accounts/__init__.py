"""Accounts, the Data Management Portal and saved items (see routes.py)."""
import logging

from app.database import Base, engine

from .models import DatasetRecord, SavedItem, User
from .routes import auth_router, items_router, records_router

log = logging.getLogger(__name__)

__all__ = ["auth_router", "records_router", "items_router", "init_tables"]


def init_tables() -> None:
    """Create the account tables if they don't exist yet. Only touches these
    three tables, never the hazard catalogue."""
    try:
        Base.metadata.create_all(
            engine, tables=[User.__table__, DatasetRecord.__table__, SavedItem.__table__]
        )
    except Exception as exc:  # DB down at boot shouldn't take the public map down too
        log.warning("Could not create account tables (sign-in will fail until it can): %s", exc)
