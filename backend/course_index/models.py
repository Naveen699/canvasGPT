from typing import Any, Literal

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


MaterialPlanStatus = Literal["new", "changed", "unchanged", "stale", "skipped"]
VectorStoreStatus = Literal["not_created", "missing", "pending", "ready", "failed"]


class CourseIndexBaseModel(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class CourseIndexMaterialPlacement(CourseIndexBaseModel):
    material_key: str = Field(alias="materialKey", min_length=1)
    source_kind: str | None = Field(default=None, alias="sourceKind")
    module_id: str | None = Field(default=None, alias="moduleId")
    module_name: str | None = Field(default=None, alias="moduleName")
    module_item_id: str | None = Field(default=None, alias="moduleItemId")
    position: int | None = None
    label: str | None = None


class CourseIndexMaterial(CourseIndexBaseModel):
    material_key: str = Field(alias="materialKey", min_length=1)
    kind: str = Field(min_length=1)
    title: str | None = None
    canvas_url: str | None = Field(default=None, alias="canvasUrl")
    canvas_updated_at: str | None = Field(default=None, alias="canvasUpdatedAt")
    content_hash: str | None = Field(default=None, alias="contentHash")
    size: int | None = Field(default=None, ge=0)
    content_type: str | None = Field(default=None, alias="contentType")
    file_name: str | None = Field(default=None, alias="fileName")
    supported_for_indexing: bool = Field(default=True, alias="supportedForIndexing")

    @field_validator(
        "title",
        "canvas_url",
        "canvas_updated_at",
        "content_hash",
        "content_type",
        "file_name",
        mode="before",
    )
    @classmethod
    def normalize_optional_text(cls, value: Any) -> str | None:
        return _compact_optional(value)


class CourseIndexCollectionError(CourseIndexBaseModel):
    source: str | None = Field(
        default=None,
        validation_alias=AliasChoices("source", "name", "kind"),
    )
    message: str | None = None


class CourseIndexManifest(CourseIndexBaseModel):
    canvas_origin: str | None = Field(default=None, alias="canvasOrigin")
    course_id: str | None = Field(default=None, alias="courseId")
    course_name: str | None = Field(default=None, alias="courseName")
    canvas_user_id: str | None = Field(default=None, alias="canvasUserId")
    local_profile_id: str | None = Field(default=None, alias="localProfileId")
    materials: list[CourseIndexMaterial] = Field(default_factory=list)
    placements: list[CourseIndexMaterialPlacement] = Field(default_factory=list)
    collection_errors: list[CourseIndexCollectionError] = Field(
        default_factory=list,
        alias="collectionErrors",
    )

    @field_validator(
        "canvas_origin",
        "course_id",
        "course_name",
        "canvas_user_id",
        "local_profile_id",
        mode="before",
    )
    @classmethod
    def normalize_optional_text(cls, value: Any) -> str | None:
        return _compact_optional(value)


class CourseIndexIdentityRequest(CourseIndexBaseModel):
    canvas_origin: str = Field(alias="canvasOrigin", min_length=1)
    course_id: str = Field(alias="courseId", min_length=1)
    course_name: str | None = Field(default=None, alias="courseName")
    canvas_user_id: str | None = Field(default=None, alias="canvasUserId")
    local_profile_id: str | None = Field(default=None, alias="localProfileId")

    @model_validator(mode="after")
    def require_user_or_profile(self) -> "CourseIndexIdentityRequest":
        has_canvas_user = self._has_value(self.canvas_user_id)
        has_local_profile = self._has_value(self.local_profile_id)
        if has_canvas_user or has_local_profile:
            return self

        raise ValueError("canvasUserId or localProfileId is required")

    @staticmethod
    def _has_value(value: str | None) -> bool:
        return value is not None and bool(value.strip())


class CourseIndexPrepareRequest(CourseIndexBaseModel):
    canvas_origin: str | None = Field(default=None, alias="canvasOrigin")
    course_id: str | None = Field(default=None, alias="courseId")
    course_name: str | None = Field(default=None, alias="courseName")
    canvas_user_id: str | None = Field(default=None, alias="canvasUserId")
    local_profile_id: str | None = Field(default=None, alias="localProfileId")
    manifest: CourseIndexManifest = Field(default_factory=CourseIndexManifest)

    @model_validator(mode="before")
    @classmethod
    def accept_top_level_manifest_fields(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        normalized = dict(data)
        manifest = normalized.get("manifest")
        if not isinstance(manifest, dict):
            manifest = {}

        for key in (
            "canvasOrigin",
            "courseId",
            "courseName",
            "canvasUserId",
            "localProfileId",
            "materials",
            "placements",
            "collectionErrors",
        ):
            if key in normalized and key not in manifest:
                manifest[key] = normalized[key]

        normalized["manifest"] = manifest
        return normalized

    @model_validator(mode="after")
    def validate_identity(self) -> "CourseIndexPrepareRequest":
        self.canvas_origin = _compact(self.canvas_origin or self.manifest.canvas_origin)
        self.course_id = _compact(self.course_id or self.manifest.course_id)
        self.course_name = _compact(self.course_name or self.manifest.course_name)
        self.canvas_user_id = _compact(
            self.canvas_user_id or self.manifest.canvas_user_id
        )
        local_profile_id = self.local_profile_id or self.manifest.local_profile_id
        self.local_profile_id = _compact(
            None if self.canvas_user_id else local_profile_id
        )

        if self.canvas_origin and self.course_id:
            has_canvas_user = self._has_value(self.canvas_user_id)
            has_local_profile = self._has_value(self.local_profile_id)
            if has_canvas_user or has_local_profile:
                return self

        raise ValueError(
            "canvasOrigin, courseId, and canvasUserId or localProfileId are required"
        )

    @property
    def materials(self) -> list[CourseIndexMaterial]:
        return self.manifest.materials

    @property
    def placements(self) -> list[CourseIndexMaterialPlacement]:
        return self.manifest.placements

    @staticmethod
    def _has_value(value: str | None) -> bool:
        return value is not None and bool(value.strip())


class CourseIndexConsentRequest(CourseIndexBaseModel):
    course_index_id: str = Field(alias="courseIndexId", min_length=1)
    consent_granted: bool = Field(
        validation_alias=AliasChoices("consentGranted", "granted"),
        serialization_alias="consentGranted",
    )


class CourseIndexSkippedMaterial(CourseIndexBaseModel):
    material_key: str = Field(alias="materialKey")
    title: str | None = None
    reason: str
    message: str | None = None


class CourseIndexWarning(CourseIndexBaseModel):
    material_key: str | None = Field(default=None, alias="materialKey")
    title: str | None = None
    reason: str
    message: str


class CourseIndexPlanCounts(CourseIndexBaseModel):
    new: int = 0
    changed: int = 0
    unchanged: int = 0
    stale: int = 0
    skipped: int = 0


class CourseIndexSyncPlan(CourseIndexBaseModel):
    new_count: int = Field(default=0, alias="newCount")
    changed_count: int = Field(default=0, alias="changedCount")
    unchanged_count: int = Field(default=0, alias="unchangedCount")
    stale_count: int = Field(default=0, alias="staleCount")
    skipped_count: int = Field(default=0, alias="skippedCount")
    new: list[str] = Field(default_factory=list)
    changed: list[str] = Field(default_factory=list)
    unchanged: list[str] = Field(default_factory=list)
    stale: list[str] = Field(default_factory=list)
    skipped: list[CourseIndexSkippedMaterial] = Field(default_factory=list)


class CourseIndexPrepareResponse(CourseIndexBaseModel):
    course_index_id: str = Field(alias="courseIndexId")
    consent_required: bool = Field(alias="consentRequired")
    consent_granted: bool = Field(alias="consentGranted")
    vector_store_status: VectorStoreStatus = Field(alias="vectorStoreStatus")
    sync_plan: CourseIndexSyncPlan = Field(alias="syncPlan")
    warnings: list[CourseIndexWarning] = Field(default_factory=list)


class CourseIndexConsentResponse(CourseIndexBaseModel):
    course_index_id: str = Field(alias="courseIndexId")
    consent_granted: bool = Field(alias="consentGranted")


def _compact(value: str | None) -> str | None:
    if value is None:
        return None

    stripped = value.strip()
    return stripped or None


def _compact_optional(value: Any) -> str | None:
    if value is None:
        return None

    stripped = str(value).strip()
    return stripped or None
