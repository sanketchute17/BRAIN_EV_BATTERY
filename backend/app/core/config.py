from pydantic_settings import BaseSettings
from typing import List, Union
import os

class Settings(BaseSettings):
    PROJECT_NAME: str = "BRAIN - Battery Risk & Analytics Intelligence Network"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    
    # Environment Configuration
    ENVIRONMENT: str = "development"
    
    # Security
    SECRET_KEY: str = "brain_ev_super_secret_jwt_key_2026_academic_research"
    JWT_SECRET: str = ""
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7 # 7 days
    
    # Database Configuration
    DATABASE_URL: str = "sqlite:///./brain_ev.db"
    
    # CORS Configuration
    CORS_ORIGINS: Union[str, List[str]] = "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173"
    
    # PKL File Directory
    PKL_DATA_DIR: str = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../data"))

    def model_post_init(self, __context):
        if self.JWT_SECRET:
            self.SECRET_KEY = self.JWT_SECRET

    def get_jwt_secret(self) -> str:
        return self.SECRET_KEY

    def get_cors_origins(self) -> List[str]:
        if isinstance(self.CORS_ORIGINS, list):
            return self.CORS_ORIGINS
        if isinstance(self.CORS_ORIGINS, str):
            if not self.CORS_ORIGINS.strip():
                return []
            if self.CORS_ORIGINS.strip() == "*":
                return ["*"]
            return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]
        return ["http://localhost:5173"]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True
        extra = "ignore"

settings = Settings()

