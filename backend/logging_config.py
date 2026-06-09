import logging
import re
from collections.abc import Mapping
from typing import Any
from urllib.parse import parse_qsl, urlsplit

from backend.config import BackendConfig


REDACTED = "[redacted]"
SENSITIVE_FIELD_NAME_PARTS = (
    "authorization",
    "body",
    "bytes",
    "cookie",
    "file_bytes",
    "filedownloadurl",
    "api_key",
    "apikey",
    "openai_api_key",
    "password",
    "prompt",
    "secret",
    "token",
    "visibletext",
)
SENSITIVE_URL_QUERY_KEYS = {
    "access_token",
    "authenticity_token",
    "download_frd",
    "expires",
    "signature",
    "sig",
    "token",
    "verifier",
}

_BEARER_RE = re.compile(r"\bbearer\s+[a-z0-9._~+/=-]+", re.IGNORECASE)
_OPENAI_KEY_RE = re.compile(r"\bsk-[a-zA-Z0-9_-]{8,}\b")
_JWT_RE = re.compile(
    r"\beyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b"
)
_URL_RE = re.compile(r"https?://[^\s'\"<>]+", re.IGNORECASE)


class PrivacyRedactionFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = redact_for_logging(record.msg)
        if isinstance(record.args, Mapping):
            record.args = redact_for_logging(record.args)
        elif record.args:
            record.args = tuple(redact_for_logging(arg) for arg in record.args)

        return True


def configure_logging(config: BackendConfig) -> None:
    level = _parse_log_level(config.log_level)
    root_logger = logging.getLogger()

    if not root_logger.handlers:
        logging.basicConfig(
            level=level,
            format="%(levelname)s %(name)s %(message)s",
        )

    root_logger.setLevel(level)

    logging.getLogger("canvasgpt").setLevel(level)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    for handler in root_logger.handlers:
        handler.setLevel(level)
        _add_redaction_filter(handler)


def redact_for_logging(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            key: REDACTED if _is_sensitive_key(key) else redact_for_logging(item)
            for key, item in value.items()
        }

    if isinstance(value, list):
        return [redact_for_logging(item) for item in value]

    if isinstance(value, tuple):
        return tuple(redact_for_logging(item) for item in value)

    if isinstance(value, set):
        return {redact_for_logging(item) for item in value}

    if isinstance(value, (bytes, bytearray, memoryview)):
        return REDACTED

    if isinstance(value, str):
        return _redact_sensitive_text(value)

    return value


def _add_redaction_filter(handler: logging.Handler) -> None:
    if any(isinstance(item, PrivacyRedactionFilter) for item in handler.filters):
        return

    handler.addFilter(PrivacyRedactionFilter())


def _parse_log_level(value: str | None) -> int:
    if value is None:
        return logging.INFO

    level = logging.getLevelName(value.strip().upper())
    if isinstance(level, int):
        return level

    return logging.INFO


def _is_sensitive_key(key: Any) -> bool:
    normalized = str(key).replace("-", "_").lower()
    return any(field in normalized for field in SENSITIVE_FIELD_NAME_PARTS)


def _redact_sensitive_text(value: str) -> str:
    normalized = value.strip()
    lowered = normalized.lower()
    if lowered.startswith(("authorization:", "cookie:", "set-cookie:")):
        return REDACTED

    if _BEARER_RE.search(normalized):
        return REDACTED

    if _OPENAI_KEY_RE.search(normalized):
        return REDACTED

    if _JWT_RE.search(normalized):
        return REDACTED

    if any(_url_looks_signed(url) for url in _URL_RE.findall(normalized)):
        return REDACTED

    return value


def _url_looks_signed(url: str) -> bool:
    parsed_url = urlsplit(url)
    if parsed_url.scheme not in {"http", "https"}:
        return False

    query_keys = {
        key.lower()
        for key, _value in parse_qsl(parsed_url.query, keep_blank_values=True)
    }
    return bool(query_keys & SENSITIVE_URL_QUERY_KEYS)
