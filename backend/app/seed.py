"""
One-off seed script: creates tables (dev convenience — use Alembic migrations
for anything beyond local prototyping) and loads the nine hazard themes plus
the starter layer catalogue from data/catalogue/hazard_layers.json.

Run with:  python -m app.seed
"""
import json
from pathlib import Path

from app.database import Base, engine, SessionLocal
from app.models import HazardTheme, Layer, Scenario

CATALOGUE_PATH = Path(__file__).resolve().parents[2] / "data" / "catalogue" / "hazard_layers.json"

HAZARD_THEMES = [
    ("coastal_flooding", "Coastal Flooding & Storm Surge", 1),
    ("pluvial_flooding", "Pluvial & Flash Flooding", 2),
    ("riverine_flooding", "Riverine & Lagoon Flooding", 3),
    ("compound_flooding", "Compound Flooding", 4),
    ("land_subsidence", "Land Subsidence", 5),
    ("extreme_heat", "Extreme Heat / Urban Heat Island", 6),
    ("coastal_erosion", "Coastal Erosion", 7),
    ("drought_water_stress", "Drought / Water Stress / Quality", 8),
    ("landslides", "Landslides / Mudslides", 9),
]

SCENARIOS = [
    ("baseline", "Current / Baseline", "present"),
    ("2050_moderate", "2050 — Moderate Emissions", "2050"),
    ("2050_high", "2050 — High Emissions", "2050"),
    ("2080_high", "2080 — High Emissions", "2080"),
]


def run():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        for id_, name, order in HAZARD_THEMES:
            if not db.get(HazardTheme, id_):
                db.add(HazardTheme(id=id_, name=name, display_order=order))

        for id_, label, period in SCENARIOS:
            if not db.get(Scenario, id_):
                db.add(Scenario(id=id_, label=label, time_period=period))

        db.commit()

        if CATALOGUE_PATH.exists():
            catalogue = json.loads(CATALOGUE_PATH.read_text())
            for entry in catalogue:
                existing = db.get(Layer, entry["id"])
                if existing is None:
                    db.add(Layer(**entry))
                    continue
                # Update in place rather than skipping. The old behaviour
                # ("insert only if absent") meant a layer already in the
                # database could never be corrected by re-seeding, which is
                # the sole reason the fix_*.sql files exist — every style
                # bug (expression, nodata, Earth Search asset names,
                # max_native_zoom) had to be hand-written as SQL because
                # the catalogue was the source of truth everywhere except
                # in the one database that mattered.
                for column, value in entry.items():
                    setattr(existing, column, value)
            db.commit()
        print("Seed complete.")
    finally:
        db.close()


if __name__ == "__main__":
    run()
