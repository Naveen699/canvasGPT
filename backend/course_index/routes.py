from collections import defaultdict
from collections.abc import Iterable
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status

from backend.catalog.identity import CourseIdentityError
from backend.catalog.repository import CatalogRepository
from backend.course_index.models import (
    CourseIndexConsentRequest,
    CourseIndexConsentResponse,
    CourseIndexMaterial,
    CourseIndexMaterialPlacement,
    CourseIndexPrepareRequest,
    CourseIndexPrepareResponse,
    CourseIndexSkippedMaterial,
    CourseIndexSyncPlan,
    CourseIndexWarning,
)
from backend.course_index.sync_plan import build_sync_plan


router = APIRouter(prefix="/course-index", tags=["course-index"])


@router.post(
    "/prepare",
    response_model=CourseIndexPrepareResponse,
    response_model_by_alias=True,
)
def prepare_course_index(
    payload: CourseIndexPrepareRequest,
    request: Request,
) -> CourseIndexPrepareResponse:
    repository = _repository_from_request(request)
    try:
        course = repository.get_or_create_course(
            canvas_origin=payload.canvas_origin,
            course_id=payload.course_id,
            course_name=payload.course_name,
            canvas_user_id=payload.canvas_user_id,
            local_profile_id=payload.local_profile_id,
        )
    except CourseIdentityError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc
    existing_materials = _list_materials_by_course(repository, course["id"])
    existing_by_key = {
        row["material_key"]: row
        for row in existing_materials
        if _compact(row.get("material_key"))
    }

    plan = build_sync_plan(
        incoming_materials=payload.materials,
        existing_materials=existing_materials,
        max_file_bytes=request.app.state.config.max_file_bytes,
    )
    skipped_by_key = _skipped_by_key(plan.skipped)
    status_by_key = _status_by_key(plan)
    persistable_material_keys = _persistable_material_keys(
        plan,
        skipped_by_key,
        existing_by_key,
    )
    warnings = [
        *_policy_skip_warnings(plan.skipped, payload.materials),
        *_collection_error_warnings(payload.manifest.collection_errors),
    ]

    placements_by_key = _placements_by_key(payload.placements)
    persisted_material_keys: set[str] = set()
    for material in payload.materials:
        if material.material_key in persisted_material_keys:
            continue
        if material.material_key not in persistable_material_keys:
            continue

        persisted_material_keys.add(material.material_key)
        skipped = skipped_by_key.get(material.material_key)
        existing = existing_by_key.get(material.material_key)
        status_value = _material_status(material, status_by_key, skipped, existing)

        _upsert_manifest_material_metadata(
            repository,
            course_id=course["id"],
            material=material,
            status_value=status_value,
            skipped=skipped,
        )

    _replace_placements_for_manifest_materials(
        repository,
        course_id=course["id"],
        placements_by_key=placements_by_key,
        material_keys=[material.material_key for material in payload.materials],
    )

    return CourseIndexPrepareResponse(
        courseIndexId=course["id"],
        consentRequired=True,
        consentGranted=bool(course.get("consent_granted")),
        vectorStoreStatus=_vector_store_status(course),
        syncPlan=plan,
        warnings=warnings,
    )


def _upsert_manifest_material_metadata(
    repository: CatalogRepository,
    *,
    course_id: str,
    material: CourseIndexMaterial,
    status_value: str,
    skipped: dict[str, str] | None,
) -> None:
    kwargs = {
        "course_id": course_id,
        "material_key": material.material_key,
        "kind": material.kind,
        "title": material.title,
        "canvas_url": material.canvas_url,
        "canvas_updated_at": material.canvas_updated_at,
        "content_hash": material.content_hash,
        "size": material.size,
        "content_type": material.content_type,
        "file_name": material.file_name,
        "status": status_value,
        "error_type": skipped["reason"] if skipped else None,
        "error_message": skipped["message"] if skipped else None,
    }

    if hasattr(repository, "upsert_manifest_material_metadata"):
        repository.upsert_manifest_material_metadata(**kwargs)
        return

    repository.upsert_material_placeholder(**kwargs)


def _replace_placements_for_manifest_materials(
    repository: CatalogRepository,
    *,
    course_id: str,
    placements_by_key: dict[str, list[dict[str, Any]]],
    material_keys: list[str],
) -> None:
    complete_placements_by_key = {
        material_key: placements_by_key.get(material_key, [])
        for material_key in dict.fromkeys(material_keys)
    }

    if hasattr(repository, "replace_placements_for_manifest_materials"):
        repository.replace_placements_for_manifest_materials(
            course_id=course_id,
            placements_by_material_key=complete_placements_by_key,
        )
        return

    for material_key, placements in complete_placements_by_key.items():
        repository.replace_material_placements(
            course_id=course_id,
            material_key=material_key,
            placements=placements,
        )


@router.post(
    "/consent",
    response_model=CourseIndexConsentResponse,
    response_model_by_alias=True,
)
def set_course_index_consent(
    payload: CourseIndexConsentRequest,
    request: Request,
) -> CourseIndexConsentResponse:
    course_index_id = _compact(payload.course_index_id)
    if not course_index_id:
        raise HTTPException(
            status_code=422,
            detail="courseIndexId is required",
        )

    repository = _repository_from_request(request)
    course = repository.get_course_by_id(course_index_id)
    if course is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course index not found",
        )

    course = _set_consent_state(
        repository,
        course_index_id,
        granted=payload.consent_granted,
    )
    return CourseIndexConsentResponse(
        courseIndexId=course_index_id,
        consentGranted=bool(course.get("consent_granted")),
    )


def _repository_from_request(request: Request) -> CatalogRepository:
    return CatalogRepository(request.app.state.config.db_path)


def _list_materials_by_course(
    repository: CatalogRepository,
    course_id: str,
) -> list[dict[str, Any]]:
    if hasattr(repository, "list_materials_by_course"):
        return repository.list_materials_by_course(course_id=course_id)

    with repository.connect() as connection:
        cursor = connection.execute(
            "SELECT * FROM materials WHERE course_id = ?",
            (course_id,),
        )
        return [dict(row) for row in cursor.fetchall()]


def _set_consent_state(
    repository: CatalogRepository,
    course_id: str,
    *,
    granted: bool,
) -> dict[str, Any]:
    if hasattr(repository, "set_consent_state"):
        return repository.set_consent_state(
            course_id=course_id,
            consent_granted=granted,
        )

    timestamp = repository._timestamp()
    with repository.connect() as connection:
        connection.execute(
            """
            UPDATE courses
            SET consent_granted = ?, updated_at = ?
            WHERE id = ?
            """,
            (1 if granted else 0, timestamp, course_id),
        )
        cursor = connection.execute(
            "SELECT * FROM courses WHERE id = ?",
            (course_id,),
        )
        return dict(cursor.fetchone())


def _material_status(
    material: CourseIndexMaterial,
    status_by_key: dict[str, str],
    skipped: dict[str, str] | None,
    existing: dict[str, Any] | None,
) -> str:
    if skipped:
        return "skipped"

    plan_status = status_by_key.get(material.material_key)
    if plan_status in {"new", "changed"}:
        return "pending"

    if existing is not None:
        if _compact(existing.get("status")) == "skipped":
            return "pending"

        return _compact(existing.get("status")) or "pending"

    return plan_status or "pending"


def _status_by_key(plan: CourseIndexSyncPlan) -> dict[str, str]:
    statuses: dict[str, str] = {}
    for status_name in ("new", "changed", "unchanged"):
        for material_key in getattr(plan, status_name):
            statuses[material_key] = status_name

    return statuses


def _persistable_material_keys(
    plan: CourseIndexSyncPlan,
    skipped_by_key: dict[str, dict[str, str]],
    existing_by_key: dict[str, dict[str, Any]],
) -> set[str]:
    return {
        *plan.new,
        *plan.changed,
        *(
            material_key
            for material_key in plan.unchanged
            if _compact(existing_by_key.get(material_key, {}).get("status")) == "skipped"
            and material_key not in skipped_by_key
        ),
        *skipped_by_key.keys(),
    }


def _skipped_by_key(
    skipped: Iterable[CourseIndexSkippedMaterial],
) -> dict[str, dict[str, str]]:
    skipped_by_key: dict[str, dict[str, str]] = {}
    for material in skipped:
        if material.reason == "duplicate_material_key":
            continue

        skipped_by_key[material.material_key] = {
            "reason": material.reason,
            "message": material.message or "Skipped during course index preparation.",
        }

    return skipped_by_key


def _placements_by_key(
    placements: Iterable[CourseIndexMaterialPlacement],
) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for placement in placements:
        grouped[placement.material_key].append(
            {
                "source_kind": placement.source_kind,
                "module_id": placement.module_id,
                "module_name": placement.module_name,
                "module_item_id": placement.module_item_id,
                "position": placement.position,
                "label": placement.label,
            }
        )

    return grouped


def _policy_skip_warnings(
    skipped: Iterable[CourseIndexSkippedMaterial],
    materials: Iterable[CourseIndexMaterial],
) -> list[CourseIndexWarning]:
    material_titles = {
        material.material_key: material.title
        for material in materials
        if _compact(material.material_key)
    }
    warnings: list[CourseIndexWarning] = []
    for skipped_material in skipped:
        if skipped_material.reason not in {"too_large", "unsupported_file_type"}:
            continue

        warnings.append(
            CourseIndexWarning(
                materialKey=skipped_material.material_key,
                title=material_titles.get(skipped_material.material_key),
                reason=skipped_material.reason,
                message=(
                    skipped_material.message
                    or "Material was skipped by backend file indexing policy."
                ),
            )
        )

    return warnings


def _collection_error_warnings(collection_errors: Iterable[Any]) -> list[CourseIndexWarning]:
    warnings: list[CourseIndexWarning] = []
    for error in collection_errors:
        warnings.append(
            CourseIndexWarning(
                reason="collection_error",
                message=_collection_error_message(error),
            )
        )

    return warnings


def _collection_error_message(error: Any) -> str:
    if isinstance(error, dict):
        message = _compact(error.get("message") or error.get("error") or error.get("name"))
        source = _compact(error.get("source") or error.get("name") or error.get("kind"))
        if source and message:
            return f"{source}: {message}"
        if message:
            return message

    message = _compact(getattr(error, "message", None))
    source = _compact(
        getattr(error, "source", None)
        or getattr(error, "name", None)
        or getattr(error, "kind", None)
    )
    if source and message:
        return f"{source}: {message}"
    if message:
        return message

    return _compact(error) or "Canvas material collection reported an error."


def _vector_store_status(course: dict[str, Any]) -> str:
    if not bool(course.get("consent_granted")):
        return "not_created"

    if not _compact(course.get("vector_store_id")):
        return "not_created"

    sync_status = _compact(course.get("sync_status"))
    if sync_status in {"missing", "pending", "ready", "failed"}:
        return sync_status

    return "pending"


def _compact(value: Any) -> str | None:
    if value is None:
        return None

    text = str(value).strip()
    return text or None
