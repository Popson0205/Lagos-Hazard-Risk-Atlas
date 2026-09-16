from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import HazardTheme
from app.schemas import HazardThemeOut

router = APIRouter(prefix="/hazards", tags=["hazards"])


@router.get("", response_model=list[HazardThemeOut])
def list_hazards(db: Session = Depends(get_db)):
    themes = db.execute(select(HazardTheme).order_by(HazardTheme.display_order)).scalars().all()
    return themes
