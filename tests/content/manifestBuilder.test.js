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
            fileDownloadPath: "/courses/12345/files/987/download",
            raw: { position: 3 }
          },
          {
            type: "moduleItem",
            id: "mi-2",
            moduleId: "m-2",
            moduleName: "Week 2",
            title: "Lecture slides again",
            itemType: "File",
            contentId: "987",
            fileDownloadPath: "/courses/12345/files/987/download",
            raw: { position: 7 }
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
    expect(manifest.materials.find((material) => material.materialKey === "file:987").contentHash).toBe("");
    expect(manifest.placements.filter((placement) => placement.materialKey === "file:987")).toMatchObject([
      { sourceKind: "file" },
      {
        sourceKind: "module",
        moduleId: "m-1",
        moduleName: "Week 1",
        moduleItemId: "mi-1",
        position: 3,
        label: "Lecture slides"
      },
      {
        sourceKind: "module",
        moduleId: "m-2",
        moduleName: "Week 2",
        moduleItemId: "mi-2",
        position: 7,
        label: "Lecture slides again"
      }
    ]);
  });

  it("deduplicates a page that appears in both modules and the page list", () => {
    const { manifest } = buildWithHelpers({
      canvasBaseUrl: "https://canvas.example.edu",
      courseId: "12345",
      materials: {
        pages: [
          {
            title: "Week 1 Overview",
            url: "week-1",
            htmlUrl: "https://canvas.example.edu/courses/12345/pages/week-1"
          }
        ],
        modules: [
          {
            type: "moduleItem",
            id: "mi-page-1",
            moduleId: "module-1",
            moduleName: "Week 1",
            title: "Week 1 Overview",
            itemType: "Page",
            pageUrl: "week-1",
            htmlUrl: "https://canvas.example.edu/courses/12345/pages/week-1"
          }
        ]
      }
    });

    expect(manifest.materials.filter((material) => material.materialKey === "page:week-1")).toHaveLength(1);
    expect(manifest.placements.filter((placement) => placement.materialKey === "page:week-1")).toMatchObject([
      { sourceKind: "page", label: "Week 1 Overview" },
      {
        sourceKind: "module",
        moduleId: "module-1",
        moduleName: "Week 1",
        moduleItemId: "mi-page-1",
        label: "Week 1 Overview"
      }
    ]);
  });

  it("deduplicates repeated page module references into one material with multiple placements", () => {
    const { manifest } = buildWithHelpers({
      canvasBaseUrl: "https://canvas.example.edu",
      courseId: "12345",
      materials: {
        pages: [
          {
            title: "Week 1 Overview",
            url: "week-1-overview",
            htmlUrl: "https://canvas.example.edu/courses/12345/pages/week-1-overview"
          }
        ],
        modules: [
          {
            type: "moduleItem",
            id: "mi-page-1",
            moduleId: "module-a",
            moduleName: "Module A",
            title: "Read the overview",
            itemType: "Page",
            pageUrl: "week-1-overview",
            htmlUrl: "https://canvas.example.edu/courses/12345/pages/week-1-overview",
            raw: { position: 1 }
          },
          {
            type: "moduleItem",
            id: "mi-page-2",
            moduleId: "module-b",
            moduleName: "Module B",
            title: "Review the overview",
            itemType: "Page",
            pageUrl: "week-1-overview",
            htmlUrl: "https://canvas.example.edu/courses/12345/pages/week-1-overview",
            raw: { position: 4 }
          }
        ]
      }
    });

    expect(manifest.materials.filter((material) => material.materialKey === "page:week-1-overview")).toHaveLength(1);
    expect(manifest.placements.filter((placement) => placement.materialKey === "page:week-1-overview")).toMatchObject([
      { sourceKind: "page", label: "Week 1 Overview" },
      {
        sourceKind: "module",
        moduleId: "module-a",
        moduleName: "Module A",
        moduleItemId: "mi-page-1",
        position: 1,
        label: "Read the overview"
      },
      {
        sourceKind: "module",
        moduleId: "module-b",
        moduleName: "Module B",
        moduleItemId: "mi-page-2",
        position: 4,
        label: "Review the overview"
      }
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

  it("does not collect discussion replies as indexable discussion materials", () => {
    const { manifest } = buildWithHelpers({
      canvasBaseUrl: "https://canvas.example.edu",
      courseId: "12345",
      materials: {
        discussions: [
          {
            id: "topic-1",
            title: "Discussion Topic",
            htmlUrl: "https://canvas.example.edu/courses/12345/discussion_topics/topic-1"
          },
          {
            id: "reply-1",
            discussion_topic_id: "topic-1",
            parent_id: "entry-1",
            title: "Discussion Reply",
            body: "Reply text"
          }
        ]
      }
    });

    expect(manifest.materials.map((material) => material.materialKey)).toEqual(["discussion:topic-1"]);
    expect(manifest.placements.map((placement) => placement.materialKey)).toEqual(["discussion:topic-1"]);
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
      localProfileId: "",
      collectedAt: "2026-06-04T12:00:00Z",
      materials: [
        {
          materialKey: "assignment:77",
          kind: "assignment",
          title: "Midterm Policy",
          canvasUrl: "https://canvas.example.edu/courses/12345/assignments/77",
          canvasUpdatedAt: "2026-05-31T10:00:00Z",
          contentHash: "sha256:44548872615d01f015d4d95c5342a37cc293833d2b1c121b8ab106c62f661670",
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

  it("uses Canvas user identity when Canvas provides one", () => {
    const { manifest } = buildWithHelpers({
      canvasBaseUrl: "https://canvas.example.edu",
      courseId: "12345",
      currentUser: { id: 67890 }
    });

    expect(manifest.canvasUserId).toBe("67890");
    expect(manifest.localProfileId).toBe("");
  });

  it("computes native Canvas content hashes from normalized body content", () => {
    const first = buildWithHelpers({
      canvasBaseUrl: "https://canvas.example.edu",
      courseId: "12345",
      materials: {
        pages: [
          {
            title: "Line Test",
            url: "line-test",
            body: "Line 1\r\n  Line 2  "
          }
        ]
      }
    }).manifest.materials[0];
    const second = buildWithHelpers({
      canvasBaseUrl: "https://canvas.example.edu",
      courseId: "12345",
      materials: {
        pages: [
          {
            title: "Line Test",
            url: "line-test",
            body: "Line 1\nLine 2"
          }
        ]
      }
    }).manifest.materials[0];

    expect(first.body).toBe("Line 1\nLine 2");
    expect(first.contentHash).toBe(
      "sha256:9140ddc651fb3861322111773bee1afd59db94a6dcba56212a5cabd8aaaf6874"
    );
    expect(second.contentHash).toBe(first.contentHash);
  });

  it("uses a persisted local profile identity when Canvas user identity is unavailable", () => {
    const { manifest } = buildWithHelpers({
      canvasBaseUrl: "https://canvas.example.edu",
      courseId: "12345",
      localProfileId: "local_profile_abc"
    });

    expect(manifest.canvasUserId).toBe("");
    expect(manifest.localProfileId).toBe("local_profile_abc");
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

  it("keeps collection non-fatal and reports optional endpoint failures", () => {
    const { manifest } = buildWithHelpers({
      canvasBaseUrl: "https://canvas.example.edu",
      courseId: "12345",
      errors: [
        { name: "modules", message: "Canvas API returned 403" },
        { name: "files", message: "Canvas API returned 404" },
        { name: "pages", message: "Canvas API returned 500" },
        { name: "assignments", message: "Canvas API returned 503" },
        { name: "announcements", message: "Canvas API returned 401" },
        { name: "discussions", message: "Canvas API returned 429" }
      ]
    });

    expect(manifest.materials).toEqual([]);
    expect(manifest.placements).toEqual([]);
    expect(manifest.collectionErrors).toEqual([
      { name: "modules", message: "Canvas API returned 403" },
      { name: "files", message: "Canvas API returned 404" },
      { name: "pages", message: "Canvas API returned 500" },
      { name: "assignments", message: "Canvas API returned 503" },
      { name: "announcements", message: "Canvas API returned 401" },
      { name: "discussions", message: "Canvas API returned 429" }
    ]);
  });

  it("includes module item load errors from raw module graph data", () => {
    const { manifest } = buildWithHelpers({
      canvasBaseUrl: "https://canvas.example.edu",
      courseId: "12345",
      modules: [
        {
          id: "m-1",
          name: "Week 1",
          items: [],
          itemsLoadError: "Canvas API returned 403"
        }
      ],
      materials: {
        assignments: [
          {
            id: "77",
            title: "Available assignment",
            htmlUrl: "https://canvas.example.edu/courses/12345/assignments/77"
          }
        ]
      }
    });

    expect(manifest.materials).toMatchObject([
      {
        materialKey: "assignment:77",
        kind: "assignment"
      }
    ]);
    expect(manifest.collectionErrors).toEqual([
      {
        name: "module_items",
        message: "Canvas API returned 403",
        moduleId: "m-1",
        moduleName: "Week 1"
      }
    ]);
  });

  it("does not duplicate collection errors passed in both old and new collection fields", () => {
    const error = { name: "pages", message: "Canvas API returned 403" };
    const { manifest } = buildWithHelpers({
      canvasBaseUrl: "https://canvas.example.edu",
      courseId: "12345",
      errors: [error],
      collectionErrors: [error]
    });

    expect(manifest.collectionErrors).toEqual([error]);
  });
});
