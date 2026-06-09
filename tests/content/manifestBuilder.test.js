import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const keyHelpers = require("../../content/materialKeys.js");
const urlHelpers = require("../../content/manifestUrl.js");
const { buildManifest } = require("../../content/manifestBuilder.js");

function createHelpers() {
  const normalizedCalls = [];
  const trackingUrlHelpers = {
    ...urlHelpers,
    normalizeCanvasUrl(url, canvasOrigin) {
      normalizedCalls.push({ url, canvasOrigin });
      return urlHelpers.normalizeCanvasUrl(url, canvasOrigin);
    }
  };

  return { normalizedCalls, urlHelpers: trackingUrlHelpers, keyHelpers };
}

function buildWithHelpers(collection) {
  const helpers = createHelpers();

  return {
    helpers,
    manifest: buildManifest(collection, {
      urlHelpers: helpers.urlHelpers,
      keyHelpers: helpers.keyHelpers
    })
  };
}

describe("CanvasManifestBuilder", () => {
  it("deduplicates a repeated file while preserving module placements", () => {
    const { manifest } = buildWithHelpers({
      canvasBaseUrl: "https://Canvas.Example.edu",
      courseId: "12345",
      course: { name: "Biology 101" },
      collectedAt: "2026-06-04T12:00:00Z",
      materials: {
        modules: [
          {
            type: "moduleItem",
            id: "mi-1",
            moduleId: "m-1",
            moduleName: "Week 1",
            title: "Lecture slides",
            itemType: "File",
            contentId: "987",
            fileDownloadPath: "/courses/12345/files/987/download"
          },
          {
            type: "moduleItem",
            id: "mi-2",
            moduleId: "m-2",
            moduleName: "Week 2",
            title: "Lecture slides again",
            itemType: "File",
            contentId: "987",
            fileDownloadPath: "/courses/12345/files/987/download"
          }
        ]
      },
      files: [
        {
          id: "987",
          filename: "lecture.pdf",
          content_type: "application/pdf",
          url: "https://canvas.example.edu/courses/12345/files/987/download"
        }
      ]
    });

    expect(manifest.materials.filter((material) => material.materialKey === "file:987")).toHaveLength(1);
    expect(manifest.placements.filter((placement) => placement.materialKey === "file:987")).toMatchObject([
      { sourceKind: "file" },
      { sourceKind: "module", moduleId: "m-1", moduleItemId: "mi-1" },
      { sourceKind: "module", moduleId: "m-2", moduleItemId: "mi-2" }
    ]);
  });

  it("adds a current-origin fallback link with the strongest normalized material key", () => {
    const { helpers, manifest } = buildWithHelpers({
      canvasBaseUrl: "https://canvas.example.edu",
      courseId: "12345",
      links: [
        {
          text: "Syllabus",
          href: "https://Canvas.Example.edu/courses/12345/pages/syllabus/?utm_source=email#week1",
          source: { type: "renderedPage", id: "/courses/12345" }
        }
      ]
    });

    expect(helpers.normalizedCalls).toContainEqual({
      url: "https://Canvas.Example.edu/courses/12345/pages/syllabus/?utm_source=email#week1",
      canvasOrigin: "https://canvas.example.edu"
    });
    expect(manifest.materials).toMatchObject([
      {
        materialKey: "page:syllabus",
        kind: "page",
        title: "Syllabus",
        canvasUrl: "https://canvas.example.edu/courses/12345/pages/syllabus"
      }
    ]);
    expect(manifest.placements).toMatchObject([
      {
        materialKey: "page:syllabus",
        sourceKind: "renderedPage",
        label: "Syllabus"
      }
    ]);
  });

  it("deduplicates API and download file links into one file material", () => {
    const { manifest } = buildWithHelpers({
      canvasBaseUrl: "https://canvas.case.edu",
      courseId: "51050",
      links: [
        {
          text: "PHYS_122_HW7_Solutions_2026s.pdf",
          href: "https://canvas.case.edu/api/v1/courses/51050/files/10181367",
          source: { type: "moduleItem", id: "api-link" }
        },
        {
          text: "PHYS_122_HW7_Solutions_2026s.pdf",
          href: "https://canvas.case.edu/courses/51050/files/10181367/download",
          source: { type: "moduleItem", id: "download-link" }
        }
      ]
    });

    expect(manifest.materials).toMatchObject([
      {
        materialKey: "file:10181367",
        kind: "file",
        title: "PHYS_122_HW7_Solutions_2026s.pdf",
        fileId: "10181367",
        fileName: "PHYS_122_HW7_Solutions_2026s.pdf"
      }
    ]);
    expect(manifest.placements).toMatchObject([
      { materialKey: "file:10181367", moduleItemId: "api-link" },
      { materialKey: "file:10181367", moduleItemId: "download-link" }
    ]);
  });

  it("excludes external links from indexable materials", () => {
    const { manifest } = buildWithHelpers({
      canvasBaseUrl: "https://canvas.example.edu",
      courseId: "12345",
      links: [
        {
          text: "External reference",
          href: "https://example.com/reference"
        }
      ],
      materials: {
        modules: [
          {
            id: "mi-external",
            moduleId: "m-1",
            moduleName: "Week 1",
            title: "Publisher site",
            itemType: "ExternalUrl",
            externalUrl: "https://publisher.example.com/book"
          }
        ]
      }
    });

    expect(manifest.materials).toEqual([]);
    expect(manifest.placements).toEqual([]);
  });

  it("builds the PRD top-level shape from current collection output", () => {
    const { manifest } = buildWithHelpers({
      canvasBaseUrl: "https://canvas.example.edu",
      courseId: "12345",
      course: { name: "Biology 101" },
      canvasUserId: "67890",
      localProfileId: "profile_abc",
      collectedAt: "2026-06-04T12:00:00Z",
      materials: {
        assignments: [
          {
            id: "77",
            title: "Midterm Policy",
            htmlUrl: "https://canvas.example.edu/courses/12345/assignments/77",
            updatedAt: "2026-05-31T10:00:00Z",
            body: "Assignment instructions"
          }
        ]
      },
      errors: [{ name: "pages", message: "Canvas API returned 403" }]
    });

    expect(Object.keys(manifest)).toEqual([
      "canvasOrigin",
      "courseId",
      "courseName",
      "canvasUserId",
      "localProfileId",
      "collectedAt",
      "materials",
      "placements",
      "collectionErrors"
    ]);
    expect(manifest).toMatchObject({
      canvasOrigin: "https://canvas.example.edu",
      courseId: "12345",
      courseName: "Biology 101",
      canvasUserId: "67890",
      localProfileId: "profile_abc",
      collectedAt: "2026-06-04T12:00:00Z",
      materials: [
        {
          materialKey: "assignment:77",
          kind: "assignment",
          title: "Midterm Policy",
          canvasUrl: "https://canvas.example.edu/courses/12345/assignments/77",
          canvasUpdatedAt: "2026-05-31T10:00:00Z",
          body: "Assignment instructions",
          supportedForIndexing: true
        }
      ],
      placements: [
        {
          materialKey: "assignment:77",
          sourceKind: "assignment",
          label: "Midterm Policy"
        }
      ],
      collectionErrors: [{ name: "pages", message: "Canvas API returned 403" }]
    });
  });

  it("uses page slug keys instead of full normalized page URLs", () => {
    const { manifest } = buildWithHelpers({
      canvasBaseUrl: "https://canvas.example.edu",
      courseId: "12345",
      materials: {
        pages: [
          {
            title: "Week 1",
            url: "week-1",
            htmlUrl: "https://canvas.example.edu/courses/12345/pages/week-1?module_item_id=9"
          }
        ]
      }
    });

    expect(manifest.materials).toMatchObject([
      {
        materialKey: "page:week-1",
        kind: "page",
        canvasUrl: "https://canvas.example.edu/courses/12345/pages/week-1?module_item_id=9"
      }
    ]);
  });
});
