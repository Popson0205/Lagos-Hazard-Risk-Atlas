from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://risk_atlas:risk_atlas@localhost:5432/risk_atlas"
    titiler_base_url: str = "http://localhost:8001"
    stac_api_url: str = "https://planetarycomputer.microsoft.com/api/stac/v1"
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
