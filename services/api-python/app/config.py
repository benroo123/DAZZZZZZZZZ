from dataclasses import dataclass
from os import getenv
from pathlib import Path


def integer(name: str, default: int) -> int:
    return int(getenv(name, str(default)))


REPO_ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class Settings:
    implementation: str = "python"
    port: int = integer("PY_API_PORT", 8100)
    public_base_url: str = getenv("PY_PUBLIC_BASE_URL", "http://127.0.0.1:8100")
    database_url: str = getenv(
        "DATABASE_URL", "postgresql://dachang:dachang@127.0.0.1:55432/dachang"
    )
    redis_url: str = getenv("REDIS_URL", "redis://127.0.0.1:56379/0")
    rabbitmq_url: str = getenv("RABBITMQ_URL", "amqp://dachang:dachang@127.0.0.1:5673")
    s3_endpoint: str = getenv("S3_ENDPOINT", "127.0.0.1")
    s3_port: int = integer("S3_PORT", 59000)
    s3_access_key: str = getenv("S3_ACCESS_KEY", "dachang")
    s3_secret_key: str = getenv("S3_SECRET_KEY", "dachang-local-secret")
    s3_bucket: str = getenv("S3_BUCKET", "media")
    s3_secure: bool = getenv("S3_USE_SSL", "false").lower() == "true"
    auth_token: str = getenv("DEMO_AUTH_TOKEN", "demo-user")
    demo_user_id: str = "11111111-1111-4111-8111-111111111111"
    model_provider: str = getenv("MODEL_PROVIDER", "local-deterministic")
    model_base_url: str = getenv("MODEL_BASE_URL", "")
    model_api_key: str = getenv("MODEL_API_KEY", "")
    model_name: str = getenv("MODEL_NAME", "dachang-local-v1")
    demo_assets_dir: Path = Path(
        getenv(
            "DEMO_ASSETS_DIR",
            str(REPO_ROOT / "activity-social-app-product" / "prototype" / "assets"),
        )
    )


settings = Settings()
