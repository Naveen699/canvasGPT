from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, BinaryIO, Protocol, cast, runtime_checkable


JsonScalar = str | int | float | bool | None
JsonValue = JsonScalar | list["JsonValue"] | dict[str, "JsonValue"]
VectorStoreMetadata = Mapping[str, str]
FileAttributeValue = str | int | float | bool
FileAttributes = Mapping[str, FileAttributeValue]
FileSearchFilters = Mapping[str, JsonValue]
ResponseInput = str | Sequence[Mapping[str, Any]]
FileContent = bytes | BinaryIO


class OpenAIClientConfigurationError(RuntimeError):
    """Raised when the OpenAI client cannot be initialized safely."""


@dataclass(frozen=True)
class OpenAIClientSettings:
    api_key: str | None = field(default=None, repr=False)


@dataclass(frozen=True)
class VectorStore:
    id: str
    name: str | None = None
    status: str | None = None
    metadata: dict[str, str] = field(default_factory=dict)
    expires_after: dict[str, str | int] | None = None
    expires_at: int | None = None


@dataclass(frozen=True)
class UploadedFile:
    id: str
    filename: str | None = None
    bytes: int | None = None
    purpose: str | None = None


@dataclass(frozen=True)
class DeletionResult:
    id: str
    deleted: bool


@dataclass(frozen=True)
class FileBatch:
    id: str
    vector_store_id: str | None = None
    status: str | None = None
    file_counts: dict[str, int] = field(default_factory=dict)


@dataclass(frozen=True)
class ResponseResult:
    id: str
    status: str | None = None
    output_text: str | None = None


@dataclass(frozen=True)
class VectorStoreFileAttachment:
    file_id: str
    attributes: FileAttributes | None = None


@runtime_checkable
class OpenAIClientProtocol(Protocol):
    def create_vector_store(
        self,
        name: str,
        expires_after_days: int,
        metadata: VectorStoreMetadata,
    ) -> VectorStore: ...

    def retrieve_vector_store(self, vector_store_id: str) -> VectorStore: ...

    def delete_vector_store(self, vector_store_id: str) -> DeletionResult: ...

    def upload_file(
        self,
        file_name: str,
        content_bytes_or_stream: FileContent,
    ) -> UploadedFile: ...

    def delete_file(self, file_id: str) -> DeletionResult: ...

    def attach_file_batch(
        self,
        vector_store_id: str,
        files_with_attributes: Sequence[VectorStoreFileAttachment],
    ) -> FileBatch: ...

    def retrieve_file_batch(
        self,
        vector_store_id: str,
        batch_id: str,
    ) -> FileBatch: ...

    def create_response_with_file_search(
        self,
        model: str,
        input: ResponseInput,
        vector_store_id: str,
        filters: FileSearchFilters | None = None,
    ) -> ResponseResult: ...


class OpenAIClient:
    def __init__(
        self,
        settings: OpenAIClientSettings | None = None,
        *,
        api_key: str | None = None,
        sdk_client: Any | None = None,
    ) -> None:
        self._api_key = api_key if api_key is not None else _settings_api_key(settings)
        self._sdk_client_instance = sdk_client

    def create_vector_store(
        self,
        name: str,
        expires_after_days: int,
        metadata: VectorStoreMetadata,
    ) -> VectorStore:
        _validate_expires_after_days(expires_after_days)
        result = self._sdk_client().vector_stores.create(
            name=name,
            expires_after={
                "anchor": "last_active_at",
                "days": expires_after_days,
            },
            metadata=dict(metadata),
        )
        return _vector_store_from_result(result)

    def retrieve_vector_store(self, vector_store_id: str) -> VectorStore:
        result = self._sdk_client().vector_stores.retrieve(vector_store_id)
        return _vector_store_from_result(result)

    def delete_vector_store(self, vector_store_id: str) -> DeletionResult:
        result = self._sdk_client().vector_stores.delete(vector_store_id)
        return _deletion_from_result(result)

    def upload_file(
        self,
        file_name: str,
        content_bytes_or_stream: FileContent,
    ) -> UploadedFile:
        result = self._sdk_client().files.create(
            file=(file_name, content_bytes_or_stream),
            purpose="assistants",
        )
        return _uploaded_file_from_result(result)

    def delete_file(self, file_id: str) -> DeletionResult:
        result = self._sdk_client().files.delete(file_id)
        return _deletion_from_result(result)

    def attach_file_batch(
        self,
        vector_store_id: str,
        files_with_attributes: Sequence[VectorStoreFileAttachment],
    ) -> FileBatch:
        result = self._sdk_client().vector_stores.file_batches.create(
            vector_store_id=vector_store_id,
            files=[
                _file_attachment_payload(attachment)
                for attachment in files_with_attributes
            ],
        )
        return _file_batch_from_result(result)

    def retrieve_file_batch(
        self,
        vector_store_id: str,
        batch_id: str,
    ) -> FileBatch:
        result = self._sdk_client().vector_stores.file_batches.retrieve(
            batch_id,
            vector_store_id=vector_store_id,
        )
        return _file_batch_from_result(result)

    def create_response_with_file_search(
        self,
        model: str,
        input: ResponseInput,
        vector_store_id: str,
        filters: FileSearchFilters | None = None,
    ) -> ResponseResult:
        file_search_tool: dict[str, Any] = {
            "type": "file_search",
            "vector_store_ids": [vector_store_id],
        }
        if filters is not None:
            file_search_tool["filters"] = dict(filters)

        result = self._sdk_client().responses.create(
            model=model,
            input=input,
            tools=[file_search_tool],
        )
        return _response_from_result(result)

    def _sdk_client(self) -> Any:
        if self._sdk_client_instance is None:
            if not self._api_key:
                raise OpenAIClientConfigurationError("OPENAI_API_KEY is required")
            self._sdk_client_instance = _build_sdk_client(self._api_key)

        return self._sdk_client_instance


def build_openai_client(settings: OpenAIClientSettings) -> OpenAIClientProtocol:
    return OpenAIClient(settings)


def _settings_api_key(settings: OpenAIClientSettings | None) -> str | None:
    if settings is None:
        return None

    return settings.api_key


def _build_sdk_client(api_key: str | None) -> Any:
    try:
        from openai import OpenAI
    except ImportError as exc:
        raise OpenAIClientConfigurationError(
            "Install the openai package to use OpenAIClient"
        ) from exc

    kwargs = {"api_key": api_key} if api_key else {}
    return OpenAI(**kwargs)


def _validate_expires_after_days(expires_after_days: int) -> None:
    if expires_after_days < 1 or expires_after_days > 365:
        raise ValueError("expires_after_days must be between 1 and 365")


def _file_attachment_payload(
    attachment: VectorStoreFileAttachment,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"file_id": attachment.file_id}
    if attachment.attributes is not None:
        payload["attributes"] = dict(attachment.attributes)

    return payload


def _vector_store_from_result(value: Any) -> VectorStore:
    data = _to_plain_dict(value)
    return VectorStore(
        id=_required_response_text(data, "id"),
        name=_optional_response_text(data, "name"),
        status=_optional_response_text(data, "status"),
        metadata=_string_dict(data.get("metadata")),
        expires_after=_expires_after(data.get("expires_after")),
        expires_at=_optional_response_int(data, "expires_at"),
    )


def _uploaded_file_from_result(value: Any) -> UploadedFile:
    data = _to_plain_dict(value)
    return UploadedFile(
        id=_required_response_text(data, "id"),
        filename=_optional_response_text(data, "filename"),
        bytes=_optional_response_int(data, "bytes"),
        purpose=_optional_response_text(data, "purpose"),
    )


def _deletion_from_result(value: Any) -> DeletionResult:
    data = _to_plain_dict(value)
    return DeletionResult(
        id=_required_response_text(data, "id"),
        deleted=bool(data.get("deleted")),
    )


def _file_batch_from_result(value: Any) -> FileBatch:
    data = _to_plain_dict(value)
    return FileBatch(
        id=_required_response_text(data, "id"),
        vector_store_id=_optional_response_text(data, "vector_store_id"),
        status=_optional_response_text(data, "status"),
        file_counts=_int_dict(data.get("file_counts")),
    )


def _response_from_result(value: Any) -> ResponseResult:
    data = _to_plain_dict(value)
    return ResponseResult(
        id=_required_response_text(data, "id"),
        status=_optional_response_text(data, "status"),
        output_text=_optional_response_text(data, "output_text"),
    )


def _to_plain_dict(value: Any) -> dict[str, Any]:
    if hasattr(value, "model_dump"):
        dumped = value.model_dump(mode="json")
        if isinstance(dumped, Mapping):
            return cast(dict[str, Any], _to_plain_value(dumped))

    if hasattr(value, "to_dict"):
        dumped = value.to_dict()
        if isinstance(dumped, Mapping):
            return cast(dict[str, Any], _to_plain_value(dumped))

    if isinstance(value, Mapping):
        return cast(dict[str, Any], _to_plain_value(value))

    public_values = {
        key: item
        for key, item in vars(value).items()
        if not key.startswith("_")
    }
    return cast(dict[str, Any], _to_plain_value(public_values))


def _to_plain_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _to_plain_value(item) for key, item in value.items()}

    if isinstance(value, list):
        return [_to_plain_value(item) for item in value]

    if isinstance(value, tuple):
        return tuple(_to_plain_value(item) for item in value)

    return value


def _required_response_text(data: Mapping[str, Any], key: str) -> str:
    value = _optional_response_text(data, key)
    if value is None:
        raise ValueError(f"OpenAI response is missing required field: {key}")

    return value


def _optional_response_text(data: Mapping[str, Any], key: str) -> str | None:
    value = data.get(key)
    if value is None:
        return None

    return str(value)


def _optional_response_int(data: Mapping[str, Any], key: str) -> int | None:
    value = data.get(key)
    if value is None:
        return None

    return int(value)


def _string_dict(value: object) -> dict[str, str]:
    if not isinstance(value, Mapping):
        return {}

    return {str(key): str(item) for key, item in value.items()}


def _int_dict(value: object) -> dict[str, int]:
    if not isinstance(value, Mapping):
        return {}

    return {str(key): int(item) for key, item in value.items()}


def _expires_after(value: object) -> dict[str, str | int] | None:
    if not isinstance(value, Mapping):
        return None

    expires_after: dict[str, str | int] = {}
    for key, item in value.items():
        if isinstance(item, int):
            expires_after[str(key)] = item
        elif item is not None:
            expires_after[str(key)] = str(item)

    return expires_after
