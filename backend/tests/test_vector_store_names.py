import inspect
import string

import pytest

from backend.catalog.identity import CourseIdentityError
from backend.catalog.vector_store_names import build_vector_store_name


def test_vector_store_name_has_expected_shape() -> None:
    name = build_vector_store_name(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        canvas_user_id="67890",
    )
    parts = name.split(":")

    assert parts[0] == "canvasgpt"
    assert parts[2] == "12345"
    assert len(parts) == 4
    assert len(parts[1]) == 64
    assert len(parts[3]) == 64
    assert set(parts[1]).issubset(set(string.hexdigits.lower()))
    assert set(parts[3]).issubset(set(string.hexdigits.lower()))


def test_vector_store_name_is_stable_for_normalized_origin() -> None:
    first_name = build_vector_store_name(
        canvas_origin="https://Canvas.Example.edu/courses/12345?ignored=true",
        course_id="12345",
        canvas_user_id="67890",
    )
    second_name = build_vector_store_name(
        canvas_origin="https://canvas.example.edu/",
        course_id="12345",
        canvas_user_id="67890",
    )

    assert first_name == second_name


def test_vector_store_name_uses_local_profile_when_canvas_user_is_missing() -> None:
    name = build_vector_store_name(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        local_profile_id="profile_abc",
    )

    assert name.startswith("canvasgpt:")
    assert name.split(":")[2] == "12345"


def test_vector_store_name_does_not_include_sensitive_raw_values() -> None:
    name = build_vector_store_name(
        canvas_origin="https://student.canvas.example.edu",
        course_id="biology-101",
        canvas_user_id="student@example.edu",
    )

    assert "student.canvas.example.edu" not in name
    assert "canvas.example.edu" not in name
    assert "student@example.edu" not in name
    assert "student" not in name
    assert "example.edu" not in name
    assert "Biology 101" not in name


def test_vector_store_name_does_not_accept_course_name() -> None:
    signature = inspect.signature(build_vector_store_name)

    assert "course_name" not in signature.parameters


def test_same_identity_value_with_different_identity_types_produces_different_names() -> None:
    canvas_user_name = build_vector_store_name(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        canvas_user_id="same-value",
    )
    local_profile_name = build_vector_store_name(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        local_profile_id="same-value",
    )

    assert canvas_user_name != local_profile_name


def test_canvas_user_takes_precedence_over_local_profile() -> None:
    with_profile = build_vector_store_name(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        canvas_user_id="67890",
        local_profile_id="profile_abc",
    )
    without_profile = build_vector_store_name(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        canvas_user_id="67890",
    )

    assert with_profile == without_profile


def test_vector_store_name_changes_when_origin_course_or_identity_changes() -> None:
    baseline_name = build_vector_store_name(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        canvas_user_id="67890",
    )

    assert baseline_name != build_vector_store_name(
        canvas_origin="https://other.example.edu",
        course_id="12345",
        canvas_user_id="67890",
    )
    assert baseline_name != build_vector_store_name(
        canvas_origin="https://canvas.example.edu",
        course_id="67890",
        canvas_user_id="67890",
    )
    assert baseline_name != build_vector_store_name(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        canvas_user_id="other-user",
    )


@pytest.mark.parametrize(
    ("canvas_origin", "course_id", "canvas_user_id", "local_profile_id"),
    [
        ("", "12345", "67890", None),
        ("https://canvas.example.edu", "", "67890", None),
        ("https://canvas.example.edu", "12345", None, None),
    ],
)
def test_vector_store_name_requires_origin_course_and_identity(
    canvas_origin: str,
    course_id: str,
    canvas_user_id: str | None,
    local_profile_id: str | None,
) -> None:
    with pytest.raises(CourseIdentityError):
        build_vector_store_name(
            canvas_origin=canvas_origin,
            course_id=course_id,
            canvas_user_id=canvas_user_id,
            local_profile_id=local_profile_id,
        )
