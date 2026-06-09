from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from backend.config import DEFAULT_MAX_FILE_BYTES
from backend.course_index.file_policy import (
    evaluate_file_policy,
    should_apply_file_policy,
)
from backend.course_index.models import (
    CourseIndexMaterial,
    CourseIndexSkippedMaterial,
    CourseIndexSyncPlan,
)


@dataclass(frozen=True)
class ExistingMaterialSnapshot:
    material_key: str
    content_hash: str | None = None
    canvas_updated_at: str | None = None
    size: int | None = None
    content_type: str | None = None
    file_name: str | None = None
    status: str | None = None


def build_sync_plan(
    *,
    incoming_materials: Sequence[CourseIndexMaterial],
    existing_materials: Sequence[ExistingMaterialSnapshot | Mapping[str, Any]],
    max_file_bytes: int = DEFAULT_MAX_FILE_BYTES,
) -> CourseIndexSyncPlan:
    existing_by_key = {
        material.material_key: material
        for material in map(_coerce_existing, existing_materials)
    }
    seen_manifest_keys: set[str] = set()

    new: list[str] = []
    changed: list[str] = []
    unchanged: list[str] = []
    skipped: list[CourseIndexSkippedMaterial] = []

    for material in incoming_materials:
        if material.material_key in seen_manifest_keys:
            continue

        seen_manifest_keys.add(material.material_key)
        if should_apply_file_policy(
            kind=material.kind,
            size=material.size,
            content_type=material.content_type,
            file_name=material.file_name,
        ):
            policy_decision = evaluate_file_policy(
                size=material.size,
                content_type=material.content_type,
                file_name=material.file_name,
                max_file_bytes=max_file_bytes,
            )
            if not policy_decision.allowed:
                skipped.append(
                    CourseIndexSkippedMaterial(
                        material_key=material.material_key,
                        title=material.title,
                        reason=policy_decision.reason or "file_policy_violation",
                        message=policy_decision.message,
                    )
                )
                continue

        existing = existing_by_key.get(material.material_key)
        if existing is None:
            new.append(material.material_key)
        elif _material_changed(material, existing):
            changed.append(material.material_key)
        else:
            unchanged.append(material.material_key)

    stale = sorted(set(existing_by_key) - seen_manifest_keys)

    return CourseIndexSyncPlan(
        newCount=len(new),
        changedCount=len(changed),
        unchangedCount=len(unchanged),
        staleCount=len(stale),
        skippedCount=len(skipped),
        new=new,
        changed=changed,
        unchanged=unchanged,
        stale=stale,
        skipped=skipped,
    )


def _coerce_existing(
    material: ExistingMaterialSnapshot | Mapping[str, Any],
) -> ExistingMaterialSnapshot:
    if isinstance(material, ExistingMaterialSnapshot):
        return material

    return ExistingMaterialSnapshot(
        material_key=str(material["material_key"]),
        content_hash=_optional_str(material.get("content_hash")),
        canvas_updated_at=_optional_str(material.get("canvas_updated_at")),
        size=_optional_int(material.get("size")),
        content_type=_optional_str(material.get("content_type")),
        file_name=_optional_str(material.get("file_name")),
        status=_optional_str(material.get("status")),
    )


def _material_changed(
    incoming: CourseIndexMaterial,
    existing: ExistingMaterialSnapshot,
) -> bool:
    comparable_fields = (
        (_optional_str(incoming.content_hash), existing.content_hash),
        (_optional_str(incoming.canvas_updated_at), existing.canvas_updated_at),
    )
    return any(
        incoming_value is not None and incoming_value != existing_value
        for incoming_value, existing_value in comparable_fields
    )


def _optional_str(value: object) -> str | None:
    if value is None:
        return None

    normalized = str(value).strip()
    return normalized or None


def _optional_int(value: object) -> int | None:
    if value is None:
        return None

    return int(value)
