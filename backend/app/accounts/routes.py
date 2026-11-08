"""
Routes for the signed-in parts of the atlas:

    /auth/*      sign up, sign in, profile, password, access requests
    /records/*   the Data Management Portal (dataset submissions + review)
    /me/items/*  saved map views and saved areas of interest

The public map (hazards, layers, tiles, boundaries) stays open and needs no
token; only these routes do.
"""
from __future__ import annotations

import base64
import binascii
import csv
import io
import re
import secrets
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db

from .models import DatasetRecord, SavedItem, User, UserAvatar
from .security import create_token, current_user, hash_password, is_admin, verify_password

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# ---------------------------------------------------------------- schemas


class UserOut(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    professional_role: str | None = None
    organization: str | None = None
    preferences: dict[str, Any] = {}
    avatar_url: str | None = None
    created_at: datetime

    @classmethod
    def of(cls, u: User) -> "UserOut":
        token = (u.preferences or {}).get("avatar_token")
        return cls(
            avatar_url=f"{get_settings().api_v1_prefix}/users/{u.id}/avatar/{token}" if token else None,
            id=u.id,
            email=u.email,
            full_name=u.full_name,
            role=u.role,
            professional_role=u.professional_role,
            organization=u.organization,
            preferences=u.preferences or {},
            created_at=u.created_at,
        )


class AuthOut(BaseModel):
    token: str
    user: UserOut


def _check_email(v: str) -> str:
    v = v.strip().lower()
    if not _EMAIL_RE.match(v):
        raise ValueError("Enter a valid email address.")
    return v


class SignupIn(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=160)
    organization: str | None = Field(default=None, max_length=200)
    professional_role: str | None = Field(default=None, max_length=160)
    remember: bool = False

    _email = field_validator("email")(_check_email)


class LoginIn(BaseModel):
    email: str
    password: str
    remember: bool = False

    _email = field_validator("email")(_check_email)


class ProfileIn(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=160)
    professional_role: str | None = Field(default=None, max_length=160)
    organization: str | None = Field(default=None, max_length=200)
    preferences: dict[str, Any] | None = None


class PasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class AccessRequestIn(BaseModel):
    note: str = Field(default="", max_length=1000)


RecordStatus = Literal["draft", "submitted", "published", "rejected"]


class RecordIn(BaseModel):
    title: str = Field(min_length=3, max_length=240)
    description: str | None = Field(default=None, max_length=5000)
    hazard_theme_id: str = Field(min_length=1, max_length=64)
    region: str = Field(min_length=1, max_length=160)
    data_url: str | None = Field(default=None, max_length=2000)
    data_format: str | None = Field(default=None, max_length=32)
    # Contributors may only choose draft or submitted here.
    status: Literal["draft", "submitted"] = "draft"


class RecordPatch(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=240)
    description: str | None = Field(default=None, max_length=5000)
    hazard_theme_id: str | None = Field(default=None, max_length=64)
    region: str | None = Field(default=None, max_length=160)
    data_url: str | None = Field(default=None, max_length=2000)
    data_format: str | None = Field(default=None, max_length=32)


class StatusIn(BaseModel):
    status: RecordStatus
    note: str | None = Field(default=None, max_length=2000)


class RecordOut(BaseModel):
    id: int
    code: str
    title: str
    description: str | None
    hazard_theme_id: str
    region: str
    status: str
    data_url: str | None
    data_format: str | None
    review_note: str | None
    owner_id: int
    owner_name: str
    created_at: datetime
    updated_at: datetime
    can_edit: bool
    can_review: bool

    @classmethod
    def of(cls, r: DatasetRecord, me: User) -> "RecordOut":
        return cls(
            id=r.id,
            code=r.code or f"RD-{r.created_at.year}-{r.id:03d}",
            title=r.title,
            description=r.description,
            hazard_theme_id=r.hazard_theme_id,
            region=r.region,
            status=r.status,
            data_url=r.data_url,
            data_format=r.data_format,
            review_note=r.review_note,
            owner_id=r.owner_id,
            owner_name=r.owner.full_name if r.owner else "Unknown",
            created_at=r.created_at,
            updated_at=r.updated_at,
            can_edit=_can_edit(r, me),
            can_review=is_admin(me) and r.status in ("submitted", "published", "rejected"),
        )


class RecordPage(BaseModel):
    items: list[RecordOut]
    total: int
    page: int
    page_size: int


class RecordStats(BaseModel):
    total: int
    published: int
    submitted: int
    draft: int
    rejected: int


class SavedItemIn(BaseModel):
    kind: Literal["map", "aoi"]
    name: str = Field(min_length=1, max_length=160)
    payload: dict[str, Any]


class SavedItemOut(BaseModel):
    id: int
    kind: str
    name: str
    payload: dict[str, Any]
    created_at: datetime


# ---------------------------------------------------------------- helpers


def _can_edit(r: DatasetRecord, me: User) -> bool:
    if is_admin(me):
        return True
    return r.owner_id == me.id and r.status in ("draft", "submitted", "rejected")


def _visible(me: User):
    """Published records are visible to everyone signed in; your own records
    are always visible to you; reviewers also see everything submitted."""
    clauses = [DatasetRecord.status == "published", DatasetRecord.owner_id == me.id]
    if is_admin(me):
        clauses.append(DatasetRecord.status.in_(["submitted", "rejected"]))
    return or_(*clauses)


def _get_record(db: Session, record_id: int, me: User) -> DatasetRecord:
    r = db.execute(select(DatasetRecord).where(DatasetRecord.id == record_id, _visible(me))).scalar_one_or_none()
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Record not found.")
    return r


def _admin_emails() -> set[str]:
    raw = get_settings().admin_emails or ""
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


# ---------------------------------------------------------------- auth

# Preference keys only the server may set.
_SERVER_PREFS = {"access_request", "avatar_token"}

_MAX_AVATAR_BYTES = 2 * 1024 * 1024
_IMAGE_MAGIC = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/webp": (b"RIFF",),
}


class AvatarIn(BaseModel):
    # A data URL ("data:image/jpeg;base64,...") as produced by canvas.toDataURL.
    image: str = Field(max_length=3_000_000)

auth_router = APIRouter(prefix="/auth", tags=["auth"])


@auth_router.post("/signup", response_model=AuthOut, status_code=201)
def signup(body: SignupIn, db: Session = Depends(get_db)):
    if db.execute(select(User).where(User.email == body.email)).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists. Sign in instead.")
    user = User(
        email=body.email,
        full_name=body.full_name.strip(),
        password_hash=hash_password(body.password),
        role="admin" if body.email in _admin_emails() else "contributor",
        organization=(body.organization or "").strip() or None,
        professional_role=(body.professional_role or "").strip() or None,
        preferences={"alerts": {"record_status": True, "new_published": True, "weekly_digest": False}},
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists. Sign in instead.")
    db.refresh(user)
    return AuthOut(token=create_token(user.id, body.remember), user=UserOut.of(user))


@auth_router.post("/login", response_model=AuthOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.email == body.email)).scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That email and password don't match an account.")
    # Promote anyone newly added to ADMIN_EMAILS on their next sign-in.
    if user.role != "admin" and user.email in _admin_emails():
        user.role = "admin"
        db.commit()
    return AuthOut(token=create_token(user.id, body.remember), user=UserOut.of(user))


@auth_router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return UserOut.of(user)


@auth_router.patch("/me", response_model=UserOut)
def update_me(body: ProfileIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.full_name is not None:
        user.full_name = body.full_name.strip()
    if body.professional_role is not None:
        user.professional_role = body.professional_role.strip() or None
    if body.organization is not None:
        user.organization = body.organization.strip() or None
    if body.preferences is not None:
        # Merge rather than replace, and never let the client set server-owned keys.
        merged = dict(user.preferences or {})
        merged.update({k: v for k, v in body.preferences.items() if k not in _SERVER_PREFS})
        user.preferences = merged
    db.commit()
    db.refresh(user)
    return UserOut.of(user)


@auth_router.post("/password", status_code=204)
def change_password(body: PasswordIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Your current password is incorrect.")
    user.password_hash = hash_password(body.new_password)
    db.commit()
    return Response(status_code=204)


@auth_router.post("/request-access", response_model=UserOut)
def request_access(body: AccessRequestIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    prefs = dict(user.preferences or {})
    prefs["access_request"] = {"at": datetime.now(timezone.utc).isoformat(), "note": body.note.strip()}
    user.preferences = prefs
    db.commit()
    db.refresh(user)
    return UserOut.of(user)


@auth_router.put("/me/avatar", response_model=UserOut)
def upload_avatar(body: AvatarIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    m = re.match(r"^data:(image/(?:jpeg|png|webp));base64,(.+)$", body.image, re.S)
    if not m:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Upload a JPEG, PNG or WebP image.")
    content_type = m.group(1)
    try:
        data = base64.b64decode(m.group(2), validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That image couldn't be read. Try another file.")
    if len(data) > _MAX_AVATAR_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That image is too large. Use one under 2 MB.")
    if not data.startswith(_IMAGE_MAGIC[content_type]) or (content_type == "image/webp" and data[8:12] != b"WEBP"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That file isn't a valid image.")
    token = secrets.token_urlsafe(12)
    avatar = db.get(UserAvatar, user.id)
    if avatar is None:
        avatar = UserAvatar(user_id=user.id, content_type=content_type, data=data, token=token)
        db.add(avatar)
    else:
        avatar.content_type, avatar.data, avatar.token = content_type, data, token
    prefs = dict(user.preferences or {})
    prefs["avatar_token"] = token
    user.preferences = prefs
    db.commit()
    db.refresh(user)
    return UserOut.of(user)


@auth_router.delete("/me/avatar", response_model=UserOut)
def delete_avatar(user: User = Depends(current_user), db: Session = Depends(get_db)):
    avatar = db.get(UserAvatar, user.id)
    if avatar is not None:
        db.delete(avatar)
    prefs = dict(user.preferences or {})
    prefs.pop("avatar_token", None)
    user.preferences = prefs
    db.commit()
    db.refresh(user)
    return UserOut.of(user)


# Served without a sign-in header (an <img> can't send one); the random token
# in the path is what grants access, and it changes on every upload.
avatar_router = APIRouter(prefix="/users", tags=["auth"])


@avatar_router.get("/{user_id}/avatar/{token}")
def get_avatar(user_id: int, token: str, db: Session = Depends(get_db)):
    avatar = db.get(UserAvatar, user_id)
    if avatar is None or not secrets.compare_digest(avatar.token, token):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No picture.")
    return Response(
        content=avatar.data,
        media_type=avatar.content_type,
        headers={"Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"},
    )


# ---------------------------------------------------------------- records

records_router = APIRouter(prefix="/records", tags=["records"])

_STATUS_FILTER = {"published": ["published"], "reviewing": ["submitted", "rejected"], "drafts": ["draft"]}


def _filtered(me: User, tab: str | None, q: str | None, hazard: str | None, region: str | None):
    stmt = select(DatasetRecord).where(_visible(me))
    if tab and tab in _STATUS_FILTER:
        stmt = stmt.where(DatasetRecord.status.in_(_STATUS_FILTER[tab]))
    if hazard:
        stmt = stmt.where(DatasetRecord.hazard_theme_id == hazard)
    if region:
        stmt = stmt.where(DatasetRecord.region == region)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(DatasetRecord.title).like(like), func.lower(DatasetRecord.code).like(like)))
    return stmt


@records_router.get("", response_model=RecordPage)
def list_records(
    tab: str | None = Query(None, description="all | published | reviewing | drafts"),
    q: str | None = None,
    hazard: str | None = None,
    region: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    me: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    stmt = _filtered(me, tab, q, hazard, region)
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = (
        db.execute(stmt.order_by(DatasetRecord.created_at.desc()).offset((page - 1) * page_size).limit(page_size))
        .scalars()
        .all()
    )
    return RecordPage(items=[RecordOut.of(r, me) for r in rows], total=total, page=page, page_size=page_size)


@records_router.get("/stats", response_model=RecordStats)
def record_stats(me: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(DatasetRecord.status, func.count()).where(_visible(me)).group_by(DatasetRecord.status)
    ).all()
    counts = {s: n for s, n in rows}
    return RecordStats(
        total=sum(counts.values()),
        published=counts.get("published", 0),
        submitted=counts.get("submitted", 0),
        draft=counts.get("draft", 0),
        rejected=counts.get("rejected", 0),
    )


@records_router.get("/export.csv")
def export_records(
    tab: str | None = None,
    q: str | None = None,
    hazard: str | None = None,
    me: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    rows = db.execute(_filtered(me, tab, q, hazard, None).order_by(DatasetRecord.created_at.desc())).scalars().all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "title", "hazard_theme", "status", "region", "submitted_by", "created", "updated", "data_url", "format"])
    for r in rows:
        o = RecordOut.of(r, me)
        w.writerow([o.code, o.title, o.hazard_theme_id, o.status, o.region, o.owner_name,
                    o.created_at.date().isoformat(), o.updated_at.date().isoformat(), o.data_url or "", o.data_format or ""])
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="risk-atlas-inventory-{stamp}.csv"'},
    )


@records_router.post("", response_model=RecordOut, status_code=201)
def create_record(body: RecordIn, me: User = Depends(current_user), db: Session = Depends(get_db)):
    r = DatasetRecord(
        title=body.title.strip(),
        description=(body.description or "").strip() or None,
        hazard_theme_id=body.hazard_theme_id,
        region=body.region.strip(),
        data_url=(body.data_url or "").strip() or None,
        data_format=body.data_format,
        status=body.status,
        owner_id=me.id,
    )
    db.add(r)
    db.flush()
    r.code = f"RD-{datetime.now(timezone.utc).year}-{r.id:03d}"
    db.commit()
    db.refresh(r)
    return RecordOut.of(r, me)


@records_router.get("/{record_id}", response_model=RecordOut)
def get_record(record_id: int, me: User = Depends(current_user), db: Session = Depends(get_db)):
    return RecordOut.of(_get_record(db, record_id, me), me)


@records_router.patch("/{record_id}", response_model=RecordOut)
def update_record(record_id: int, body: RecordPatch, me: User = Depends(current_user), db: Session = Depends(get_db)):
    r = _get_record(db, record_id, me)
    if not _can_edit(r, me):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Published records can only be changed by a reviewer.")
    for field, value in body.model_dump(exclude_unset=True).items():
        if isinstance(value, str):
            value = value.strip() or None
        if field in ("title", "hazard_theme_id", "region") and not value:
            continue
        setattr(r, field, value)
    db.commit()
    db.refresh(r)
    return RecordOut.of(r, me)


@records_router.post("/{record_id}/status", response_model=RecordOut)
def set_status(record_id: int, body: StatusIn, me: User = Depends(current_user), db: Session = Depends(get_db)):
    r = _get_record(db, record_id, me)
    admin = is_admin(me)
    owner = r.owner_id == me.id
    allowed: set[str] = set()
    if owner and r.status in ("draft", "rejected"):
        allowed.add("submitted")
    if owner and r.status == "submitted":
        allowed.add("draft")  # withdraw
    if admin:
        allowed |= {"published", "rejected", "draft", "submitted"}
    if body.status not in allowed or body.status == r.status:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't move this record to that status.")
    r.status = body.status
    if admin and body.note is not None:
        r.review_note = body.note.strip() or None
    db.commit()
    db.refresh(r)
    return RecordOut.of(r, me)


@records_router.delete("/{record_id}", status_code=204)
def delete_record(record_id: int, me: User = Depends(current_user), db: Session = Depends(get_db)):
    r = _get_record(db, record_id, me)
    if not (is_admin(me) or (r.owner_id == me.id and r.status != "published")):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only a reviewer can delete a published record.")
    db.delete(r)
    db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------- saved items

items_router = APIRouter(prefix="/me/items", tags=["saved items"])


def _item_out(i: SavedItem) -> SavedItemOut:
    return SavedItemOut(id=i.id, kind=i.kind, name=i.name, payload=i.payload, created_at=i.created_at)


@items_router.get("", response_model=list[SavedItemOut])
def list_items(kind: Literal["map", "aoi"] | None = None, me: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(SavedItem).where(SavedItem.user_id == me.id)
    if kind:
        stmt = stmt.where(SavedItem.kind == kind)
    return [_item_out(i) for i in db.execute(stmt.order_by(SavedItem.created_at.desc())).scalars().all()]


@items_router.post("", response_model=SavedItemOut, status_code=201)
def create_item(body: SavedItemIn, me: User = Depends(current_user), db: Session = Depends(get_db)):
    count = db.execute(select(func.count()).where(SavedItem.user_id == me.id)).scalar_one()
    if count >= 200:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You've reached the limit of 200 saved items. Delete some first.")
    item = SavedItem(user_id=me.id, kind=body.kind, name=body.name.strip(), payload=body.payload)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _item_out(item)


@items_router.delete("/{item_id}", status_code=204)
def delete_item(item_id: int, me: User = Depends(current_user), db: Session = Depends(get_db)):
    item = db.get(SavedItem, item_id)
    if item is None or item.user_id != me.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Saved item not found.")
    db.delete(item)
    db.commit()
    return Response(status_code=204)
