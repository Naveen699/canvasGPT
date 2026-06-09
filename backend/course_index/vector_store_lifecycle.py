from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from backend.catalog.repository import CatalogRepository, CatalogRow
from backend.catalog.vector_store_names import build_vector_store_name
from backend.config import BackendConfig
from backend.openai_client import OpenAIClientProtocol


VectorStoreLifecycleErrorCode = Literal[
    "course_not_found",
    "consent_required",
    "setup_failed",
]
VectorStoreLifecycleStatus = Literal["created", "reused"]


class VectorStoreLifecycleError(RuntimeError):
    def __init__(
        self,
        code: VectorStoreLifecycleErrorCode,
        message: str,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class VectorStoreLifecycleResult:
    course: CatalogRow
    vector_store_id: str
    status: VectorStoreLifecycleStatus


class VectorStoreLifecycleService:
    def __init__(
        self,
        *,
        repository: CatalogRepository,
        openai_client: OpenAIClientProtocol,
        config: BackendConfig,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._repository = repository
        self._openai_client = openai_client
        self._config = config
        self._now = now or (lambda: datetime.now(UTC))

    def ensure_vector_store(self, *, course_index_id: str) -> VectorStoreLifecycleResult:
        course = self._repository.get_course_by_id(course_index_id)
        if course is None:
            raise VectorStoreLifecycleError(
                "course_not_found",
                "Course index was not found.",
            )

        if not bool(course.get("consent_granted")):
            raise VectorStoreLifecycleError(
                "consent_required",
                "Course index consent is required before creating a vector store.",
            )

        vector_store_id = _compact(course.get("vector_store_id"))
        if vector_store_id is not None:
            updated_course = self._repository.update_course_vector_store(
                course_id=course["id"],
                vector_store_id=vector_store_id,
                expires_at=_compact(course.get("expires_at")),
                sync_status=_compact(course.get("sync_status")) or "pending",
            )
            return VectorStoreLifecycleResult(
                course=updated_course,
                vector_store_id=vector_store_id,
                status="reused",
            )

        vector_store_name = build_vector_store_name(
            canvas_origin=course["canvas_origin"],
            course_id=course["course_id"],
            canvas_user_id=course.get("canvas_user_id"),
            local_profile_id=course.get("local_profile_id"),
        )
        expires_at = _retention_expires_at(
            now=self._now(),
            retention_days=self._config.index_retention_days,
        )

        try:
            vector_store = self._openai_client.create_vector_store(
                name=vector_store_name,
                expires_after_days=self._config.index_retention_days,
                metadata={"course_index_id": course["id"]},
            )
        except Exception as exc:
            self._repository.mark_vector_store_setup_failed(course_id=course["id"])
            raise VectorStoreLifecycleError(
                "setup_failed",
                "Vector store setup failed.",
            ) from exc

        updated_course = self._repository.update_course_vector_store(
            course_id=course["id"],
            vector_store_id=vector_store.id,
            expires_at=expires_at,
            sync_status="pending",
        )
        return VectorStoreLifecycleResult(
            course=updated_course,
            vector_store_id=vector_store.id,
            status="created",
        )


def ensure_course_vector_store(
    *,
    repository: CatalogRepository,
    openai_client: OpenAIClientProtocol,
    config: BackendConfig,
    course_index_id: str,
    now: Callable[[], datetime] | None = None,
) -> VectorStoreLifecycleResult:
    service = VectorStoreLifecycleService(
        repository=repository,
        openai_client=openai_client,
        config=config,
        now=now,
    )
    return service.ensure_vector_store(course_index_id=course_index_id)


def _retention_expires_at(*, now: datetime, retention_days: int) -> str:
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)

    return (now.astimezone(UTC) + timedelta(days=retention_days)).isoformat()


def _compact(value: object) -> str | None:
    if value is None:
        return None

    text = str(value).strip()
    return text or None
