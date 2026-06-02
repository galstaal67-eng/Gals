from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "SOX System"
    environment: str = "development"
    debug: bool = True

    database_url: str = "postgresql+asyncpg://sox:sox@localhost:5432/sox"

    jwt_secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7

    entra_tenant_id: str = ""
    entra_client_id: str = ""
    entra_client_secret: str = ""

    azure_storage_connection_string: str = ""
    azure_blob_container: str = "sox-evidence"

    default_locale: str = "he"
    supported_locales: str = "he,en"

    @property
    def locales(self) -> list[str]:
        return [s.strip() for s in self.supported_locales.split(",") if s.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
