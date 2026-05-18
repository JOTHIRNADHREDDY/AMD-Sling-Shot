import os
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PROJECT_NAME: str = "AMD Hospital Assistant"
    API_V1_STR: str = "/v1"
    
    # Database
    POSTGRES_SERVER: str = "localhost"
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "postgres"
    POSTGRES_DB: str = "amd_hospital"
    POSTGRES_PORT: str = "5432"
    
    # Redis (for session memory in production)
    REDIS_URL: str = "redis://localhost:6379"

    # JWT
    SECRET_KEY: str = "a_very_secret_key_for_development_only_please_change"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # Sarvam AI — LLM Orchestration Layer (legacy, kept for backward compat)
    SARVAM_API_KEY: str = ""  # Set via .env or environment variable

    # Hugging Face — AI Provider (TTS, STT, LLM)
    HF_TOKEN: str = ""  # Set via .env or environment variable

    # ffmpeg path
    FFMPEG_PATH: str = "" 

    # Voice settings
    VOICE_MAX_AUDIO_SIZE_MB: int = 10
    VOICE_RATE_LIMIT_PER_MIN: int = 30
    VOICE_TIMEOUT_SECONDS: int = 30

    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        # Use SQLite for local development as requested
        return "sqlite+aiosqlite:///./amd_hospital.db"
    
    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../.env"),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )

settings = Settings()
