from pydantic import ValidationError

from backend.course_index.models import (
    CourseIndexSignedFile,
    CourseIndexSyncMaterial,
    CourseIndexSyncRequest,
)


def test_sync_material_accepts_body_but_excludes_it_from_serialization() -> None:
    material = CourseIndexSyncMaterial.model_validate(
        {
            "materialKey": "assignment:77",
            "kind": "assignment",
            "title": "Midterm Policy",
            "body": "Canvas body that must stay transient",
        }
    )

    assert material.body == "Canvas body that must stay transient"
    assert material.model_dump() == {
        "material_key": "assignment:77",
        "kind": "assignment",
        "title": "Midterm Policy",
        "canvas_url": None,
        "canvas_updated_at": None,
        "content_hash": None,
        "size": None,
        "content_type": None,
        "file_name": None,
        "supported_for_indexing": True,
    }
    assert "body" not in material.model_dump(by_alias=True)


def test_signed_file_accepts_signed_url_but_excludes_it_from_serialization() -> None:
    signed_file = CourseIndexSignedFile.model_validate(
        {
            "materialKey": "file:123",
            "fileId": "123",
            "fileName": "lecture.pdf",
            "contentType": "application/pdf",
            "size": 1024,
            "signedUrl": "https://canvas.example.edu/files/123/download?verifier=secret",
        }
    )

    assert (
        signed_file.signed_url
        == "https://canvas.example.edu/files/123/download?verifier=secret"
    )
    assert signed_file.model_dump(by_alias=True) == {
        "materialKey": "file:123",
        "fileId": "123",
        "fileName": "lecture.pdf",
        "contentType": "application/pdf",
        "size": 1024,
    }


def test_sync_request_excludes_all_transient_content_from_serialization() -> None:
    payload = CourseIndexSyncRequest.model_validate(
        {
            "courseIndexId": "course_abc",
            "materials": [
                {
                    "materialKey": "page:overview",
                    "kind": "page",
                    "body": "Overview body",
                }
            ],
            "signedFiles": [
                {
                    "materialKey": "file:123",
                    "fileId": "123",
                    "signedUrl": "https://signed.example.invalid/secret",
                }
            ],
        }
    )

    assert payload.materials[0].body == "Overview body"
    assert payload.signed_files[0].signed_url == "https://signed.example.invalid/secret"
    assert payload.model_dump(by_alias=True) == {
        "courseIndexId": "course_abc",
        "materials": [
            {
                "materialKey": "page:overview",
                "kind": "page",
                "title": None,
                "canvasUrl": None,
                "canvasUpdatedAt": None,
                "contentHash": None,
                "size": None,
                "contentType": None,
                "fileName": None,
                "supportedForIndexing": True,
            }
        ],
        "signedFiles": [
            {
                "materialKey": "file:123",
                "fileId": "123",
                "fileName": None,
                "contentType": None,
                "size": None,
            }
        ],
    }


def test_signed_file_rejects_negative_size() -> None:
    try:
        CourseIndexSignedFile.model_validate(
            {
                "materialKey": "file:123",
                "fileId": "123",
                "size": -1,
                "signedUrl": "https://signed.example.invalid/secret",
            }
        )
    except ValidationError as exc:
        assert exc.errors()[0]["loc"] == ("size",)
    else:
        raise AssertionError("Expected negative signed file size to fail validation")


def test_signed_file_rejects_request_credential_fields() -> None:
    try:
        CourseIndexSyncRequest.model_validate(
            {
                "courseIndexId": "course_abc",
                "signedFiles": [
                    {
                        "materialKey": "file:123",
                        "fileId": "123",
                        "signedUrl": "https://signed.example.invalid/secret",
                        "headers": {
                            "Authorization": "Bearer secret",
                            "Cookie": "canvas_session=secret",
                        },
                    }
                ],
            }
        )
    except ValidationError as exc:
        assert exc.errors()[0]["loc"] == ("signedFiles", 0)
        assert "request credential fields" in exc.errors()[0]["msg"]
    else:
        raise AssertionError("Expected credential-bearing signed file to fail validation")
