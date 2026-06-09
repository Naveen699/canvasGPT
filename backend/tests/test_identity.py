from dataclasses import asdict
import inspect
import string

import pytest

from backend.catalog.identity import (
    CourseIdentityError,
    build_course_identity,
    normalize_canvas_origin,
)


def test_same_origin_course_canvas_user_produces_same_hash_every_time() -> None:
    first_identity = build_course_identity(
        canvas_origin="https://Canvas.Example.edu/",
        course_id="12345",
        canvas_user_id="67890",
        local_profile_id="ignored-profile",
    )
    second_identity = build_course_identity(
        canvas_origin="https://canvas.example.edu/courses/12345?ignored=true",
        course_id="12345",
        canvas_user_id="67890",
    )

    assert first_identity.canvas_origin == "https://canvas.example.edu"
    assert first_identity.identity_type == "canvas_user_id"
    assert first_identity.course_key_hash == second_identity.course_key_hash


def test_same_origin_course_local_profile_produces_same_hash_every_time() -> None:
    first_identity = build_course_identity(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        local_profile_id="profile_abc",
    )
    second_identity = build_course_identity(
        canvas_origin="https://canvas.example.edu/",
        course_id="12345",
        local_profile_id="profile_abc",
    )

    assert first_identity.identity_type == "local_profile_id"
    assert first_identity.course_key_hash == second_identity.course_key_hash


def test_different_canvas_users_produce_different_hashes() -> None:
    first_hash = build_course_identity(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        canvas_user_id="user_1",
    ).course_key_hash
    second_hash = build_course_identity(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        canvas_user_id="user_2",
    ).course_key_hash

    assert first_hash != second_hash


def test_different_local_profiles_produce_different_hashes() -> None:
    first_hash = build_course_identity(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        local_profile_id="profile_1",
    ).course_key_hash
    second_hash = build_course_identity(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        local_profile_id="profile_2",
    ).course_key_hash

    assert first_hash != second_hash


def test_same_course_id_on_different_canvas_origins_produces_different_hashes() -> None:
    first_hash = build_course_identity(
        canvas_origin="https://canvas-a.example.edu",
        course_id="12345",
        canvas_user_id="67890",
    ).course_key_hash
    second_hash = build_course_identity(
        canvas_origin="https://canvas-b.example.edu",
        course_id="12345",
        canvas_user_id="67890",
    ).course_key_hash

    assert first_hash != second_hash


def test_missing_both_canvas_user_id_and_local_profile_id_raises_validation_error() -> None:
    with pytest.raises(
        CourseIdentityError,
        match="local_profile_id is required when canvas_user_id is missing",
    ):
        build_course_identity(
            canvas_origin="https://canvas.example.edu",
            course_id="12345",
        )


@pytest.mark.parametrize(
    ("canvas_origin", "course_id"),
    [
        ("", "12345"),
        ("https://canvas.example.edu", ""),
    ],
)
def test_canvas_origin_and_course_id_are_required(
    canvas_origin: str,
    course_id: str,
) -> None:
    with pytest.raises(CourseIdentityError):
        build_course_identity(
            canvas_origin=canvas_origin,
            course_id=course_id,
            local_profile_id="profile_abc",
        )


def test_hash_input_does_not_accept_course_name() -> None:
    signature = inspect.signature(build_course_identity)

    assert "course_name" not in signature.parameters


def test_hash_output_is_hex_only_and_does_not_expose_raw_identity_values() -> None:
    identity = build_course_identity(
        canvas_origin="https://student.canvas.example.edu",
        course_id="biology-101",
        canvas_user_id="student@example.edu",
    )

    assert len(identity.course_key_hash) == 64
    assert set(identity.course_key_hash).issubset(set(string.hexdigits.lower()))
    assert "canvas.example.edu" not in identity.course_key_hash
    assert "biology-101" not in identity.course_key_hash
    assert "student" not in identity.course_key_hash
    assert "example.edu" not in identity.course_key_hash
    assert "student@example.edu" not in repr(identity)
    assert "student@example.edu" not in asdict(identity).values()


def test_same_identity_value_with_different_identity_types_produces_different_hashes() -> None:
    canvas_user_hash = build_course_identity(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        canvas_user_id="same-value",
    ).course_key_hash
    local_profile_hash = build_course_identity(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        local_profile_id="same-value",
    ).course_key_hash

    assert canvas_user_hash != local_profile_hash


def test_origin_normalization_lowercases_origin_and_removes_default_ports() -> None:
    assert normalize_canvas_origin("HTTPS://Canvas.Example.edu:443/anything") == (
        "https://canvas.example.edu"
    )
    assert normalize_canvas_origin("http://Canvas.Example.edu:80/anything") == (
        "http://canvas.example.edu"
    )
    assert normalize_canvas_origin("https://canvas.example.edu:8443") == (
        "https://canvas.example.edu:8443"
    )


def test_origin_normalization_canonicalizes_host_equivalents() -> None:
    assert normalize_canvas_origin("https://Canvas.Example.edu./anything") == (
        "https://canvas.example.edu"
    )
    assert normalize_canvas_origin("https://bücher.example") == (
        "https://xn--bcher-kva.example"
    )
    assert normalize_canvas_origin("https://[0:0:0:0:0:0:0:1]:443") == (
        "https://[::1]"
    )


@pytest.mark.parametrize(
    "canvas_origin",
    [
        "canvas.example.edu",
        "ftp://canvas.example.edu",
        "https://student@example.edu@canvas.example.edu",
        "https://canvas.example.edu:bad-port",
    ],
)
def test_invalid_canvas_origins_raise_validation_error(canvas_origin: str) -> None:
    with pytest.raises(CourseIdentityError):
        normalize_canvas_origin(canvas_origin)
