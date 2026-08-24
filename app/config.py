from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://lane:lane@localhost:5432/lane"
    jwt_secret: str = "change-me-in-dev"
    jwt_expire_minutes: int = 60
    redis_url: str = "redis://localhost:6379/0"


settings = Settings()
