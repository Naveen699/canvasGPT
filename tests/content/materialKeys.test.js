import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const materialKeys = require("../../content/materialKeys.js");

describe("CanvasMaterialKeys", () => {
  it("exports a browser global when loaded in a window-like context", () => {
    expect(globalThis.CanvasMaterialKeys).toBe(materialKeys);
  });

  it("creates stable file keys from file IDs", () => {
    expect(materialKeys.getFileMaterialKey({ id: 123 })).toBe("file:123");
    expect(materialKeys.getFileMaterialKey({ file_id: "abc" })).toBe("file:abc");
    expect(materialKeys.getFileMaterialKey({ html_url: "https://canvas.example.edu/courses/1/files/987" })).toBe(
      "file:987"
    );
  });

  it("creates stable page keys from Canvas page URLs or IDs", () => {
    expect(materialKeys.getPageMaterialKey({ url: "weekly-overview" })).toBe(
      "page:weekly-overview"
    );
    expect(materialKeys.getPageMaterialKey({ page_id: 55 })).toBe("page:55");
    expect(
      materialKeys.getPageMaterialKey({
        html_url: "https://canvas.example.edu/courses/1/pages/lecture-1"
      })
    ).toBe("page:lecture-1");
  });

  it("creates stable assignment keys from assignment IDs", () => {
    expect(materialKeys.getAssignmentMaterialKey({ id: 444 })).toBe("assignment:444");
    expect(
      materialKeys.getAssignmentMaterialKey({
        html_url: "https://canvas.example.edu/courses/1/assignments/445"
      })
    ).toBe("assignment:445");
  });

  it("creates stable announcement keys from announcement IDs", () => {
    expect(materialKeys.getAnnouncementMaterialKey({ id: 91 })).toBe("announcement:91");
    expect(materialKeys.getAnnouncementMaterialKey({ announcement_id: "welcome" })).toBe(
      "announcement:welcome"
    );
  });

  it("creates discussion keys for discussion topics", () => {
    expect(materialKeys.getDiscussionMaterialKey({ id: 77, type: "discussion" })).toBe(
      "discussion:77"
    );
    expect(
      materialKeys.getDiscussionMaterialKey({
        html_url: "https://canvas.example.edu/courses/1/discussion_topics/78"
      })
    ).toBe("discussion:78");
  });

  it("does not create discussion material keys for replies or entries", () => {
    expect(
      materialKeys.getDiscussionMaterialKey({
        id: 10,
        discussion_topic_id: 77,
        parent_id: 1,
        message: "reply body"
      })
    ).toBeNull();
    expect(
      materialKeys.getDiscussionMaterialKey({
        id: 11,
        discussion_topic_id: 77,
        type: "entry"
      })
    ).toBeNull();
  });

  it("creates module-only keys for module items", () => {
    expect(materialKeys.getModuleItemMaterialKey({ id: 321 })).toBe("module_item:321");
    expect(materialKeys.getMaterialKey({ type: "moduleItem", id: 322, itemType: "ExternalUrl" })).toBe(
      "module_item:322"
    );
  });

  it("maps module items with Canvas content IDs to referenced material keys", () => {
    expect(
      materialKeys.getMaterialKey({
        type: "moduleItem",
        itemType: "File",
        id: 1,
        contentId: 22
      })
    ).toBe("file:22");
    expect(
      materialKeys.getMaterialKey({
        type: "moduleItem",
        itemType: "Assignment",
        id: 2,
        content_id: 33
      })
    ).toBe("assignment:33");
    expect(
      materialKeys.getMaterialKey({
        type: "moduleItem",
        itemType: "Discussion",
        id: 3,
        content_id: 44
      })
    ).toBe("discussion:44");
    expect(
      materialKeys.getMaterialKey({
        type: "moduleItem",
        itemType: "Page",
        id: 4,
        pageUrl: "unit-intro"
      })
    ).toBe("page:unit-intro");
  });

  it("creates fallback keys only when no stronger material key can be derived", () => {
    const normalizedUrl = "https://canvas.example.edu/courses/1/pages/syllabus";
    const fallbackUrl = "https://canvas.example.edu/courses/1/wiki";

    expect(materialKeys.getCanvasUrlMaterialKey(normalizedUrl)).toBe(`canvas_url:${normalizedUrl}`);
    expect(materialKeys.getMaterialKey({ normalizedCanvasUrl: normalizedUrl })).toBe(
      "page:syllabus"
    );
    expect(materialKeys.getMaterialKey({ normalizedCanvasUrl: fallbackUrl })).toBe(
      `canvas_url:${fallbackUrl}`
    );
  });

  it("derives stronger material keys from normalized Canvas URLs", () => {
    expect(
      materialKeys.getCanvasUrlReferencedMaterialKey(
        "https://canvas.example.edu/courses/51050/files/10181367"
      )
    ).toBe("file:10181367");
    expect(
      materialKeys.getCanvasUrlReferencedMaterialKey(
        "https://canvas.example.edu/courses/51050/files/10181367/download"
      )
    ).toBe("file:10181367");
    expect(
      materialKeys.getCanvasUrlReferencedMaterialKey(
        "https://canvas.example.edu/api/v1/courses/51050/files/10181367"
      )
    ).toBe("file:10181367");
    expect(
      materialKeys.getCanvasUrlReferencedMaterialKey(
        "https://canvas.example.edu/courses/51050/assignments/77"
      )
    ).toBe("assignment:77");
    expect(
      materialKeys.getCanvasUrlReferencedMaterialKey(
        "https://canvas.example.edu/courses/51050/pages/week-1"
      )
    ).toBe("page:week-1");
    expect(
      materialKeys.getCanvasUrlReferencedMaterialKey(
        "https://canvas.example.edu/courses/51050/discussion_topics/88"
      )
    ).toBe("discussion:88");
    expect(
      materialKeys.getCanvasUrlReferencedMaterialKey(
        "https://canvas.example.edu/courses/51050/announcements/99"
      )
    ).toBe("announcement:99");
  });

  it("returns null when an indexable material key cannot be derived", () => {
    expect(materialKeys.getFileMaterialKey({})).toBeNull();
    expect(materialKeys.getMaterialKey({ type: "externalUrl", href: "https://example.com" })).toBeNull();
  });
});
