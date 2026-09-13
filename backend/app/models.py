"""
SQLAlchemy models for the layer metadata catalogue described in section 6
("Register every published layer in a metadata catalogue containing source,
date, scenario, unit, resolution, methodology and style") and the hazard /
scenario reference tables that back the /hazards and /scenarios endpoints.

Actual hazard *data* (rasters, feature geometries) is NOT modeled here as
one-table-per-hazard; instead each vector hazard layer's features live in a
generic `hazard_features` table keyed by layer_id, and raster layers are
referenced by URL/COG path only (the pixels live in object storage / are
proxied live from Planetary Computer via STAC, not duplicated into Postgres).
This keeps the catalogue reusable across all nine hazard themes without a
schema migration every time a new hazard is added.
"""
from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import String, Text, DateTime, ForeignKey, JSON, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class HazardTheme(Base):
    __tablename__ = "hazard_themes"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # e.g. "coastal_flooding"
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon: Mapped[str | None] = mapped_column(String(128), nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, default=0)

    layers: Mapped[list["Layer"]] = relationship(back_populates="hazard_theme")


class Scenario(Base):
    __tablename__ = "scenarios"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # e.g. "2050_rcp45"
    label: Mapped[str] = mapped_column(String(128))
    time_period: Mapped[str | None] = mapped_column(String(64), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class Layer(Base):
    """One row per publishable layer — this is the metadata catalogue."""

    __tablename__ = "layers"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    hazard_theme_id: Mapped[str] = mapped_column(ForeignKey("hazard_themes.id"))
    scenario_id: Mapped[str | None] = mapped_column(ForeignKey("scenarios.id"), nullable=True)

    name: Mapped[str] = mapped_column(String(256))
    layer_type: Mapped[str] = mapped_column(String(16))  # "raster" | "vector"
    source: Mapped[str | None] = mapped_column(String(256), nullable=True)
    date_published: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(64), nullable=True)
    resolution: Mapped[str | None] = mapped_column(String(64), nullable=True)
    methodology: Mapped[str | None] = mapped_column(Text, nullable=True)

    # For raster layers: a COG URL (may be a Planetary Computer signed URL, or
    # a path under STORAGE_LOCAL_PATH / S3 for locally generated products).
    raster_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Style / legend / classification, kept as flexible JSON so each hazard
    # theme can define its own class breaks and colors without new columns.
    style: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    is_public: Mapped[bool] = mapped_column(default=True)

    hazard_theme: Mapped["HazardTheme"] = relationship(back_populates="layers")


class HazardFeature(Base):
    """Generic vector store for polygon/point hazard outputs (section 6:
    'Use PostGIS as the authoritative operational store for publishable
    vector data'). properties holds per-feature risk class/value/date etc.
    """

    __tablename__ = "hazard_features"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    layer_id: Mapped[str] = mapped_column(ForeignKey("layers.id"), index=True)
    properties: Mapped[dict] = mapped_column(JSON, default=dict)
    geom = mapped_column(Geometry(geometry_type="GEOMETRY", srid=4326))
