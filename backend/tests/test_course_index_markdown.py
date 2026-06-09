from backend.course_index.markdown import clean_body_text, serialize_material_markdown
from backend.course_index.models import (
    CourseIndexMaterial,
    CourseIndexMaterialPlacement,
)


def test_serialize_material_markdown_includes_metadata_and_clean_body() -> None:
    material = CourseIndexMaterial(
        materialKey="assignment:77",
        kind="assignment",
        title="Midterm Policy",
        canvasUrl="https://canvas.example.edu/courses/12345/assignments/77",
        canvasUpdatedAt="2026-05-31T10:00:00Z",
    )
    placements = [
        CourseIndexMaterialPlacement(
            materialKey="assignment:77",
            sourceKind="module",
            moduleId="456",
            moduleName="Week 4",
            moduleItemId="789",
            position=3,
            label="Week 4 Policy",
        )
    ]

    markdown = serialize_material_markdown(
        material=material,
        course_name="Biology 101",
        placements=placements,
        body="""
        <div>
          <p>Read <strong>chapter 4</strong> &amp; submit notes.</p>
          <script>privateToken()</script>
          <style>.hidden { display: none; }</style>
          <ul><li>First item</li><li>Second item</li></ul>
        </div>
        """,
    )

    assert markdown == (
        "# Midterm Policy\n"
        "\n"
        "- Source type: assignment\n"
        "- Course name: Biology 101\n"
        "- Material key: assignment:77\n"
        "- Canvas URL: https://canvas.example.edu/courses/12345/assignments/77\n"
        "- Updated: 2026-05-31T10:00:00Z\n"
        "- Module placements:\n"
        "  - Week 4; module id: 456; module item id: 789; position: 3; "
        "label: Week 4 Policy\n"
        "\n"
        "## Body\n"
        "\n"
        "Read chapter 4 & submit notes.\n"
        "\n"
        "- First item\n"
        "\n"
        "- Second item\n"
    )
    assert "privateToken" not in markdown
    assert "display: none" not in markdown


def test_serialize_material_markdown_accepts_mapping_payloads() -> None:
    markdown = serialize_material_markdown(
        material={
            "materialKey": "page:overview",
            "kind": "page",
            "title": "  Course\nOverview  ",
            "body": "<p>Mapping body</p>",
        },
        placements=[{"moduleName": "Intro", "position": 1}],
    )

    assert markdown == (
        "# Course Overview\n"
        "\n"
        "- Source type: page\n"
        "- Course name: Unknown\n"
        "- Material key: page:overview\n"
        "- Canvas URL: Unknown\n"
        "- Updated: Unknown\n"
        "- Module placements:\n"
        "  - Intro; position: 1\n"
        "\n"
        "## Body\n"
        "\n"
        "Mapping body\n"
    )


def test_clean_body_text_returns_placeholder_for_empty_content() -> None:
    assert clean_body_text(" <div> \n </div> ") == "No body text provided."
