from __future__ import annotations

import builtins
from dataclasses import is_dataclass

import pytest

from backend.openai_client import (
    DeletionResult,
    FileBatch,
    OpenAIClient,
    OpenAIClientConfigurationError,
    OpenAIClientProtocol,
    OpenAIClientSettings,
    ResponseResult,
    UploadedFile,
    VectorStore,
    VectorStoreFileAttachment,
)


def test_wrapper_types_are_dataclasses() -> None:
    assert is_dataclass(VectorStore)
    assert is_dataclass(UploadedFile)
    assert is_dataclass(DeletionResult)
    assert is_dataclass(FileBatch)
    assert is_dataclass(ResponseResult)
    assert is_dataclass(VectorStoreFileAttachment)


def test_openai_client_satisfies_fakeable_protocol_without_api_key() -> None:
    client = OpenAIClient(sdk_client=FakeSdk())

    assert isinstance(client, OpenAIClientProtocol)


def test_fake_sdk_does_not_import_real_openai_package(monkeypatch) -> None:
    real_import = builtins.__import__

    def fail_on_openai_import(name, *args, **kwargs):
        if name == "openai" or name.startswith("openai."):
            raise AssertionError("real OpenAI SDK import was attempted")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fail_on_openai_import)

    client = OpenAIClient(sdk_client=FakeSdk())
    result = client.retrieve_vector_store("vs_123")

    assert result.id == "vs_123"


def test_real_sdk_requires_api_key_only_when_used(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    client = OpenAIClient(OpenAIClientSettings())

    with pytest.raises(OpenAIClientConfigurationError, match="OPENAI_API_KEY"):
        client.retrieve_vector_store("vs_123")


def test_create_vector_store_sets_expiration_and_metadata() -> None:
    sdk = FakeSdk()
    client = OpenAIClient(sdk_client=sdk)

    result = client.create_vector_store(
        name="canvasgpt:origin:123:user",
        expires_after_days=7,
        metadata={"course_id": "123"},
    )

    assert result == VectorStore(
        id="vs_created",
        name="canvasgpt:origin:123:user",
        status="in_progress",
        metadata={"course_id": "123"},
        expires_after={"anchor": "last_active_at", "days": 7},
    )
    assert sdk.vector_stores.create.calls == [
        {
            "name": "canvasgpt:origin:123:user",
            "expires_after": {"anchor": "last_active_at", "days": 7},
            "metadata": {"course_id": "123"},
        }
    ]


@pytest.mark.parametrize("expires_after_days", [0, 366])
def test_create_vector_store_rejects_invalid_expiration(
    expires_after_days: int,
) -> None:
    client = OpenAIClient(sdk_client=FakeSdk())

    with pytest.raises(ValueError, match="expires_after_days"):
        client.create_vector_store(
            name="canvasgpt:origin:123:user",
            expires_after_days=expires_after_days,
            metadata={},
        )


def test_file_upload_and_delete_boundaries() -> None:
    sdk = FakeSdk()
    client = OpenAIClient(sdk_client=sdk)

    uploaded = client.upload_file("slides.pdf", b"pdf bytes")
    deleted = client.delete_file("file_123")

    assert uploaded == UploadedFile(
        id="file_123",
        filename="slides.pdf",
        bytes=9,
        purpose="assistants",
    )
    assert deleted == DeletionResult(id="file_123", deleted=True)
    assert sdk.files.create.calls == [
        {"file": ("slides.pdf", b"pdf bytes"), "purpose": "assistants"}
    ]
    assert sdk.files.delete.calls == [{"args": ("file_123",)}]


def test_vector_store_file_batch_boundaries_include_per_file_attributes() -> None:
    sdk = FakeSdk()
    client = OpenAIClient(sdk_client=sdk)

    batch = client.attach_file_batch(
        "vs_123",
        [
            VectorStoreFileAttachment(
                file_id="file_1",
                attributes={"material_key": "file:1", "visible": True},
            ),
            VectorStoreFileAttachment(file_id="file_2"),
        ],
    )
    retrieved = client.retrieve_file_batch("vs_123", "batch_123")

    assert batch == FileBatch(
        id="batch_123",
        vector_store_id="vs_123",
        status="in_progress",
        file_counts={"in_progress": 2},
    )
    assert retrieved.id == "batch_123"
    assert sdk.vector_stores.file_batches.create.calls == [
        {
            "vector_store_id": "vs_123",
            "files": [
                {
                    "file_id": "file_1",
                    "attributes": {"material_key": "file:1", "visible": True},
                },
                {"file_id": "file_2"},
            ],
        }
    ]
    assert sdk.vector_stores.file_batches.retrieve.calls == [
        {"args": ("batch_123",), "vector_store_id": "vs_123"}
    ]


def test_response_file_search_boundary_includes_vector_store_and_filters() -> None:
    sdk = FakeSdk()
    client = OpenAIClient(sdk_client=sdk)

    response = client.create_response_with_file_search(
        model="gpt-5.5",
        input="What is due this week?",
        vector_store_id="vs_123",
        filters={"type": "eq", "key": "material_kind", "value": "assignment"},
    )

    assert response == ResponseResult(
        id="resp_123",
        status="completed",
        output_text="Use the rubric from the assignment page.",
    )
    assert sdk.responses.create.calls == [
        {
            "model": "gpt-5.5",
            "input": "What is due this week?",
            "tools": [
                {
                    "type": "file_search",
                    "vector_store_ids": ["vs_123"],
                    "filters": {
                        "type": "eq",
                        "key": "material_kind",
                        "value": "assignment",
                    },
                }
            ],
        }
    ]


def test_vector_store_delete_boundary() -> None:
    sdk = FakeSdk()
    client = OpenAIClient(sdk_client=sdk)

    deleted = client.delete_vector_store("vs_123")

    assert deleted == DeletionResult(id="vs_123", deleted=True)
    assert sdk.vector_stores.delete.calls == [{"args": ("vs_123",)}]


class FakeSdk:
    def __init__(self) -> None:
        self.vector_stores = FakeVectorStores()
        self.files = FakeFiles()
        self.responses = FakeResponses()


class FakeVectorStores:
    def __init__(self) -> None:
        self.create = CaptureResult(
            {
                "id": "vs_created",
                "name": "canvasgpt:origin:123:user",
                "status": "in_progress",
                "metadata": {"course_id": "123"},
                "expires_after": {"anchor": "last_active_at", "days": 7},
            }
        )
        self.retrieve = CaptureResult(
            {
                "id": "vs_123",
                "name": "canvasgpt:origin:123:user",
                "status": "completed",
            }
        )
        self.delete = CaptureResult({"id": "vs_123", "deleted": True})
        self.file_batches = FakeFileBatches()


class FakeFileBatches:
    def __init__(self) -> None:
        result = {
            "id": "batch_123",
            "vector_store_id": "vs_123",
            "status": "in_progress",
            "file_counts": {"in_progress": 2},
        }
        self.create = CaptureResult(result)
        self.retrieve = CaptureResult(result)


class FakeFiles:
    def __init__(self) -> None:
        self.create = CaptureResult(
            {
                "id": "file_123",
                "filename": "slides.pdf",
                "bytes": 9,
                "purpose": "assistants",
            }
        )
        self.delete = CaptureResult({"id": "file_123", "deleted": True})


class FakeResponses:
    def __init__(self) -> None:
        self.create = CaptureResult(
            {
                "id": "resp_123",
                "status": "completed",
                "output_text": "Use the rubric from the assignment page.",
            }
        )


class CaptureResult:
    def __init__(self, result: dict[str, object]) -> None:
        self.result = result
        self.calls: list[dict[str, object]] = []

    def __call__(self, *args, **kwargs):
        if args:
            self.calls.append({"args": args, **kwargs})
        else:
            self.calls.append(kwargs)
        return self.result
