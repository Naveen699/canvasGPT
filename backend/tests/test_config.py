import importlib
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.config import (
    DEFAULT_INDEX_RETENTION_DAYS,
    DEFAULT_MAX_FILE_BYTES,
    ConfigError,
    load_config,
)


ENV_VARS = (
    "OPENAI_API_KEY",
    "OPENAI_RESPONSE_MODEL",
    "CANVASGPT_DB_PATH",
    "CANVASGPT_INDEX_RETENTION_DAYS",
    "CANVASGPT_MAX_FILE_BYTES",
    "CANVASGPT_LOG_LEVEL",
)


def test_defaults_resolve_backend_db_path_and_omit_openai_key() -> None:
    config = load_config({})
    backend_dir = Path(__file__).resolve().parents[1]

    assert config.openai_api_key is None
    assert config.openai_response_model is None
    assert config.db_path == (backend_dir / ".data" / "canvasgpt.sqlite3").resolve()
    assert config.index_retention_days == DEFAULT_INDEX_RETENTION_DAYS
    assert config.max_file_bytes == DEFAULT_MAX_FILE_BYTES
    assert config.log_level is None

    serialized = config.to_safe_dict()
    assert set(serialized) == {
        "openai_response_model",
        "db_path",
        "index_retention_days",
        "max_file_bytes",
        "log_level",
    }


def test_env_overrides_are_loaded_and_numeric_values_are_ints(tmp_path: Path) -> None:
    db_path = tmp_path / "canvasgpt.sqlite3"

    config = load_config(
        {
            "OPENAI_API_KEY": "sk-test-secret",
            "OPENAI_RESPONSE_MODEL": "gpt-test",
            "CANVASGPT_DB_PATH": str(db_path),
            "CANVASGPT_INDEX_RETENTION_DAYS": "14",
            "CANVASGPT_MAX_FILE_BYTES": "1024",
            "CANVASGPT_LOG_LEVEL": "debug",
        }
    )

    assert config.openai_api_key == "sk-test-secret"
    assert config.openai_response_model == "gpt-test"
    assert config.db_path == db_path.resolve()
    assert config.index_retention_days == 14
    assert isinstance(config.index_retention_days, int)
    assert config.max_file_bytes == 1024
    assert isinstance(config.max_file_bytes, int)
    assert config.log_level == "debug"
    assert "sk-test-secret" not in config.to_safe_dict().values()
    assert "sk-test-secret" not in repr(config)
    assert "sk-test-secret" not in str(config)


@pytest.mark.parametrize(
    "name",
    ("CANVASGPT_INDEX_RETENTION_DAYS", "CANVASGPT_MAX_FILE_BYTES"),
)
def test_invalid_numeric_env_vars_fail_with_clear_config_error(name: str) -> None:
    with pytest.raises(ConfigError, match=f"{name} must be an integer"):
        load_config({name: "not-an-int"})


def test_health_works_without_openai_api_key(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("CANVASGPT_DB_PATH", str(tmp_path / "canvasgpt.sqlite3"))

    sys.modules.pop("backend.main", None)
    main = importlib.import_module("backend.main")

    with TestClient(main.app) as client:
        response = client.get("/health")

    assert main.app.state.config.openai_api_key is None
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_cors_does_not_allow_wildcard_credentials(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("CANVASGPT_DB_PATH", str(tmp_path / "canvasgpt.sqlite3"))

    sys.modules.pop("backend.main", None)
    main = importlib.import_module("backend.main")

    response = TestClient(main.app).options(
        "/health",
        headers={
            "Origin": "https://example.invalid",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.headers.get("access-control-allow-origin") == "*"
    assert "access-control-allow-credentials" not in response.headers
