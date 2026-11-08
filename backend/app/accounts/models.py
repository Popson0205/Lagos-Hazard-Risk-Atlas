"""
Tables behind the signed-in parts of the atlas: user accounts, the Data
Management Portal's dataset submissions, and each user's saved map views /
areas of interest.

They're plain (non-spatial) tables so they work on any SQLAlchemy backend,
and they're created on startup with `create_all` (see accounts.init_tables)
because this project doesn't run Alembic migrations yet. db_init.sql has the
equivalent DDL for anyone provisioning the database by hand.
"""
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "atlas_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(160))
    password_hash: Mapped[str] = mapped_column(String(255))
    # "contributor" can submit datasets; "admin" (reviewer) can also publish
    # or reject them. Admins are whoever is listed in ADMIN_EMAILS.
    role: Mapped[str] = mapped_column(String(32), default="contributor")
    professional_role: Mapped[str | None] = mapped_column(String(160), nullable=True)
    organization: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Alert settings, access-request flag and other small per-user settings.
    preferences: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    records: Mapped[list["DatasetRecord"]] = relationship(back_populates="owner")


class DatasetRecord(Base):
    """One dataset submitted through the Data Management Portal."""

    __tablename__ = "atlas_dataset_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Human-facing id shown in the portal table, e.g. RD-2026-004.
    code: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)
    title: Mapped[str] = mapped_column(String(240))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    hazard_theme_id: Mapped[str] = mapped_column(String(64))
    region: Mapped[str] = mapped_column(String(160))
    # draft -> submitted -> published | rejected
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    data_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    data_format: Mapped[str | None] = mapped_column(String(32), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("atlas_users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    owner: Mapped[User] = relationship(back_populates="records")


class SavedItem(Base):
    """A saved map view ("map") or a saved area of interest ("aoi")."""

    __tablename__ = "atlas_saved_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("atlas_users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16), index=True)
    name: Mapped[str] = mapped_column(String(160))
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class UserAvatar(Base):
    """A user's profile picture, stored in the database (a ~256px JPEG/PNG/WebP,
    resized in the browser before upload) since the stack has no object store.
    Kept out of atlas_users so normal user queries don't load the image."""

    __tablename__ = "atlas_user_avatars"

    user_id: Mapped[int] = mapped_column(ForeignKey("atlas_users.id", ondelete="CASCADE"), primary_key=True)
    content_type: Mapped[str] = mapped_column(String(32))
    data: Mapped[bytes] = mapped_column(LargeBinary)
    # Random token in the picture's URL: changes on every upload (so browsers
    # can cache forever) and keeps picture URLs unguessable.
    token: Mapped[str] = mapped_column(String(32))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
