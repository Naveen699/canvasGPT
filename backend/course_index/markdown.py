from collections.abc import Mapping, Sequence
from html.parser import HTMLParser
from typing import Any

from backend.course_index.models import (
    CourseIndexMaterial,
    CourseIndexMaterialPlacement,
)


BLOCK_TAGS = frozenset(
    {
        "address",
        "article",
        "aside",
        "blockquote",
        "br",
        "dd",
        "details",
        "div",
        "dl",
        "dt",
        "figcaption",
        "figure",
        "footer",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "header",
        "hr",
        "li",
        "main",
        "nav",
        "ol",
        "p",
        "pre",
        "section",
        "table",
        "td",
        "th",
        "tr",
        "ul",
    }
)
IGNORED_TAGS = frozenset({"script", "style", "noscript", "template"})


def serialize_material_markdown(
    *,
    material: CourseIndexMaterial | Mapping[str, Any],
    course_name: str | None = None,
    placements: Sequence[CourseIndexMaterialPlacement | Mapping[str, Any]] = (),
    body: str | None = None,
) -> str:
    """Serialize Canvas material metadata and cleaned content into markdown."""

    title = _field(material, "title") or _field(material, "file_name")
    title = title or "Untitled material"
    body_text = body if body is not None else _field(material, "body")
    lines = [
        f"# {_single_line(title)}",
        "",
        f"- Source type: {_single_line(_field(material, 'kind') or 'unknown')}",
        (
            "- Course name: "
            f"{_single_line(course_name) if _compact(course_name) else 'Unknown'}"
        ),
        (
            "- Material key: "
            f"{_single_line(_field(material, 'material_key') or 'unknown')}"
        ),
        f"- Canvas URL: {_single_line(_field(material, 'canvas_url') or 'Unknown')}",
        (
            "- Updated: "
            f"{_single_line(_field(material, 'canvas_updated_at') or 'Unknown')}"
        ),
        "- Module placements:",
        *_placement_lines(placements),
        "",
        "## Body",
        "",
        clean_body_text(body_text),
    ]

    return "\n".join(lines).rstrip() + "\n"


def clean_body_text(body: str | None) -> str:
    if not _compact(body):
        return "No body text provided."

    parser = _CanvasBodyHTMLParser()
    parser.feed(str(body))
    parser.close()
    return _normalize_body_text(parser.text())


def _placement_lines(
    placements: Sequence[CourseIndexMaterialPlacement | Mapping[str, Any]],
) -> list[str]:
    if not placements:
        return ["  - None"]

    return [f"  - {_format_placement(placement)}" for placement in placements]


def _format_placement(
    placement: CourseIndexMaterialPlacement | Mapping[str, Any],
) -> str:
    parts = [
        _placement_field(placement, "module_name"),
        _prefixed("module id", _placement_field(placement, "module_id")),
        _prefixed("module item id", _placement_field(placement, "module_item_id")),
        _prefixed("position", _placement_field(placement, "position")),
        _prefixed("label", _placement_field(placement, "label")),
    ]
    compact_parts = [_single_line(part) for part in parts if _compact(part)]
    return "; ".join(compact_parts) if compact_parts else "Unlabeled module placement"


def _prefixed(label: str, value: Any) -> str | None:
    text = _compact(value)
    if text is None:
        return None

    return f"{label}: {text}"


def _field(material: CourseIndexMaterial | Mapping[str, Any], name: str) -> str | None:
    if isinstance(material, Mapping):
        return _compact(material.get(name) or material.get(_camelize(name)))

    return _compact(getattr(material, name, None))


def _placement_field(
    placement: CourseIndexMaterialPlacement | Mapping[str, Any],
    name: str,
) -> str | None:
    if isinstance(placement, Mapping):
        return _compact(placement.get(name) or placement.get(_camelize(name)))

    return _compact(getattr(placement, name, None))


def _camelize(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


def _single_line(value: Any) -> str:
    text = _compact(value)
    if text is None:
        return ""

    return " ".join(text.split())


def _compact(value: Any) -> str | None:
    if value is None:
        return None

    text = str(value).strip()
    return text or None


def _normalize_body_text(value: str) -> str:
    paragraphs = []
    for paragraph in value.split("\n"):
        normalized = " ".join(paragraph.split())
        if normalized:
            paragraphs.append(normalized)

    return "\n\n".join(paragraphs) or "No body text provided."


class _CanvasBodyHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._chunks: list[str] = []
        self._ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        normalized_tag = tag.lower()
        if normalized_tag in IGNORED_TAGS:
            self._ignored_depth += 1
            return

        if self._ignored_depth:
            return

        if normalized_tag == "li":
            self._append_break()
            self._chunks.append("- ")
        elif normalized_tag in BLOCK_TAGS:
            self._append_break()

    def handle_endtag(self, tag: str) -> None:
        normalized_tag = tag.lower()
        if normalized_tag in IGNORED_TAGS:
            self._ignored_depth = max(0, self._ignored_depth - 1)
            return

        if self._ignored_depth:
            return

        if normalized_tag in BLOCK_TAGS:
            self._append_break()

    def handle_data(self, data: str) -> None:
        if self._ignored_depth:
            return

        if data:
            self._chunks.append(data)

    def text(self) -> str:
        return "".join(self._chunks)

    def _append_break(self) -> None:
        if self._chunks and not self._chunks[-1].endswith("\n"):
            self._chunks.append("\n")
