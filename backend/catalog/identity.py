import hashlib
import ipaddress
import json
from dataclasses import dataclass
from urllib.parse import urlsplit


class CourseIdentityError(ValueError):
    """Raised when a course identity cannot safely isolate a course index."""


@dataclass(frozen=True)
class CourseIdentity:
    canvas_origin: str
    course_id: str
    identity_type: str
    course_key_hash: str


def build_course_identity(
    *,
    canvas_origin: str,
    course_id: str,
    canvas_user_id: str | None = None,
    local_profile_id: str | None = None,
) -> CourseIdentity:
    normalized_origin = normalize_canvas_origin(canvas_origin)
    normalized_course_id = _required_value(course_id, "course_id")
    identity_type, identity_value = _resolve_identity(
        canvas_user_id=canvas_user_id,
        local_profile_id=local_profile_id,
    )

    return CourseIdentity(
        canvas_origin=normalized_origin,
        course_id=normalized_course_id,
        identity_type=identity_type,
        course_key_hash=_hash_course_key(
            normalized_origin,
            normalized_course_id,
            identity_type,
            identity_value,
        ),
    )


def normalize_canvas_origin(canvas_origin: str) -> str:
    value = _required_value(canvas_origin, "canvas_origin")
    parsed = urlsplit(value)

    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise CourseIdentityError("canvas_origin must be an absolute HTTP(S) origin")

    try:
        parsed_port = parsed.port
    except ValueError as exc:
        raise CourseIdentityError("canvas_origin must include a valid port") from exc

    host = _normalize_host(parsed.hostname)
    port = _format_port(parsed.scheme.lower(), parsed_port)
    return f"{parsed.scheme.lower()}://{host}{port}"


def _resolve_identity(
    *,
    canvas_user_id: str | None,
    local_profile_id: str | None,
) -> tuple[str, str]:
    normalized_canvas_user_id = _optional_value(canvas_user_id)
    if normalized_canvas_user_id is not None:
        return "canvas_user_id", normalized_canvas_user_id

    normalized_local_profile_id = _optional_value(local_profile_id)
    if normalized_local_profile_id is not None:
        return "local_profile_id", normalized_local_profile_id

    raise CourseIdentityError(
        "local_profile_id is required when canvas_user_id is missing"
    )


def _hash_course_key(
    canvas_origin: str,
    course_id: str,
    identity_type: str,
    identity_value: str,
) -> str:
    # This is a stable pseudonymous catalog key, not an anonymity boundary.
    canonical_identity = json.dumps(
        [canvas_origin, course_id, identity_type, identity_value],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical_identity.encode("utf-8")).hexdigest()


def _format_port(scheme: str, port: int | None) -> str:
    if port is None:
        return ""

    if (scheme == "http" and port == 80) or (scheme == "https" and port == 443):
        return ""

    return f":{port}"


def _normalize_host(hostname: str) -> str:
    hostname = hostname.rstrip(".").lower()
    if not hostname:
        raise CourseIdentityError("canvas_origin must include a valid host")

    try:
        ip_address = ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        if ip_address.version == 6:
            return f"[{ip_address.compressed}]"

        return ip_address.compressed

    try:
        return hostname.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise CourseIdentityError("canvas_origin must include a valid host") from exc


def _required_value(value: str, name: str) -> str:
    normalized = _optional_value(value)
    if normalized is None:
        raise CourseIdentityError(f"{name} is required")

    return normalized


def _optional_value(value: str | None) -> str | None:
    if value is None:
        return None

    stripped = value.strip()
    return stripped or None
