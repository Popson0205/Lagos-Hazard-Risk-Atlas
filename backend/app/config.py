from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://risk_atlas:risk_atlas@localhost:5432/risk_atlas"
    # TiTiler is embedded in this app (app/tiler.py) rather than run as its own
    # service. Tile URLs handed to the browser are relative to this path, so
    # they resolve against whatever origin served the page — no per-
    # environment URL to configure.
    titiler_mount_path: str = "/titiler"
    # Where THIS process reaches its own embedded TiTiler for server-side
    # calls (zonal statistics, point lookups). Defaults to loopback on $PORT.
    titiler_internal_url: str | None = None
    port: int = 8000
    # Earth Search (AWS Open Data, run by Element 84) — a fully open STAC
    # API with no signing/API key needed (public S3-hosted COGs), unlike
    # Planetary Computer's short-lived SAS-token signing. Switched from
    # Planetary Computer after a transient TLS certificate error there;
    # same collection ids (landsat-c2-l2, sentinel-2-l2a) but Sentinel-2's
    # asset names differ — see data/catalogue/hazard_layers.json.
    stac_api_url: str = "https://earth-search.aws.element84.com/v1"
    # Landsat comes from Microsoft's Planetary Computer rather than Earth
    # Search: Earth Search points Landsat assets at s3://usgs-landsat, a
    # requester-pays bucket that needs (billed) AWS credentials, whereas
    # Planetary Computer serves the same Collection 2 Level-2 scenes from
    # free public Azure blobs, with a short-lived SAS token. See
    # services/stac_client.PLANETARY_COMPUTER_COLLECTIONS.
    planetary_computer_stac_url: str = "https://planetarycomputer.microsoft.com/api/stac/v1"
    storage_backend: str = "local"
    storage_local_path: str = "/data/cogs"
    cors_origins: str = "http://localhost:5173"
    api_v1_prefix: str = "/api/v1"
    env: str = "development"

    @property
    def titiler_internal(self) -> str:
        return (self.titiler_internal_url or f"http://127.0.0.1:{self.port}{self.titiler_mount_path}").rstrip("/")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
