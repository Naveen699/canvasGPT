import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping


DEFAULT_INDEX_RETENTION_DAYS = 7
DEFAULT_MAX_FILE_BYTES = 62_914_560


class ConfigError(ValueError):
    """Raised when backend configuration cannot be parsed safely."""


@dataclass(frozen=True)
class BackendConfig:
    openai_api_key: str | None = field(repr=False)
    openai_response_model: str | None
    db_path: Path
    index_retention_days: int
    max_file_bytes: int
    log_level: str | None

    def to_safe_dict(self) -> dict[str, str | int | None]:
        return {
            "openai_response_model": self.openai_response_model,
            "db_path": str(self.db_path),
            "index_retention_days": self.index_retention_days,
            "max_file_bytes": self.max_file_bytes,
            "log_level": self.log_level,
        }


def load_config(environ: Mapping[str, str] | None = None) -> BackendConfig:
    env = environ if environ is not None else os.environ
    backend_dir = Path(__file__).resolve().parent

    return BackendConfig(
        openai_api_key=_optional_env(env, "OPENAI_API_KEY"),
        openai_response_model=_optional_env(env, "OPENAI_RESPONSE_MODEL"),
        db_path=_load_db_path(env, backend_dir),
        index_retention_days=_parse_int_env(
            env,
            "CANVASGPT_INDEX_RETENTION_DAYS",
            DEFAULT_INDEX_RETENTION_DAYS,
        ),
        max_file_bytes=_parse_int_env(
            env,
            "CANVASGPT_MAX_FILE_BYTES",
            DEFAULT_MAX_FILE_BYTES,
        ),
        log_level=_optional_env(env, "CANVASGPT_LOG_LEVEL"),
    )


def _load_db_path(env: Mapping[str, str], backend_dir: Path) -> Path:
    value = _optional_env(env, "CANVASGPT_DB_PATH")
    if value is None:
        return (backend_dir / ".data" / "canvasgpt.sqlite3").absolute()

    return Path(value).expanduser().absolute()


def _parse_int_env(env: Mapping[str, str], name: str, default: int) -> int:
    value = env.get(name)
    if value is None:
        return default

    try:
        return int(value)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer") from exc


def _optional_env(env: Mapping[str, str], name: str) -> str | None:
    value = env.get(name)
    if value is None:
        return None

    value = value.strip()
    return value or None
