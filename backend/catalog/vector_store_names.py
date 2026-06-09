import hashlib
import json

from backend.catalog.identity import CourseIdentityError, normalize_canvas_origin


VECTOR_STORE_NAME_PREFIX = "canvasgpt"


def build_vector_store_name(
    *,
    canvas_origin: str,
    course_id: str,
    canvas_user_id: str | None = None,
    local_profile_id: str | None = None,
) -> str:
    normalized_origin = normalize_canvas_origin(canvas_origin)
    normalized_course_id = _required_value(course_id, "course_id")
    identity_type, identity_value = _resolve_identity(
        canvas_user_id=canvas_user_id,
        local_profile_id=local_profile_id,
    )

    return ":".join(
        (
            VECTOR_STORE_NAME_PREFIX,
            _hash_value(["canvas_origin", normalized_origin]),
            normalized_course_id,
            _hash_value([identity_type, identity_value]),
        )
    )


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


def _hash_value(parts: list[str]) -> str:
    canonical_value = json.dumps(
        parts,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical_value.encode("utf-8")).hexdigest()


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
