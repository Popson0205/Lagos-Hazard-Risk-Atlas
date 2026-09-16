from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://risk_atlas:risk_atlas@localhost:5432/risk_atlas"
    titiler_base_url: str = "http://localhost:8001"
    # Earth Search (AWS Open Data, run by Element 84) — a fully open STAC
    # API with no signing/API key needed (public S3-hosted COGs), unlike
    # Planetary Computer's short-lived SAS-token signing. Switched from
    # Planetary Computer after a transient TLS certificate error there;
    # same collection ids (landsat-c2-l2, sentinel-2-l2a) but Sentinel-2's
    # asset names differ — see data/catalogue/hazard_layers.json.
    stac_api_url: str = "https://earth-search.aws.element84.com/v1"
    storage_backend: str = "local"
    storage_local_path: str = "/data/cogs"
    cors_origins: str = "http://localhost:5173"
    api_v1_prefix: str = "/api/v1"
    env: str = "development"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
