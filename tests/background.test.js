import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function loadBackgroundIdentityHelpers(
  localProfileId = "local_profile_fallback",
  fetchImpl = fetch
) {
  const source = readFileSync(resolve("background.js"), "utf8");
  const context = {
    __CANVASGPT_TEST__: true,
    console,
    fetch: fetchImpl,
    importScripts: () => {},
    CanvasCollectTypes: {
      ACTIVE_PAGE_CONTEXT_MESSAGE: "COLLECT_ACTIVE_PAGE_CONTEXT"
    },
    CanvasCollectionStatus: {
      STATES: { ready: "ready" },
      createStatus: (state) => ({ state })
    },
    CanvasDetection: {
      getDefaultCanvasDomainPatterns: () => [],
      parseCanvasRoute: () => null,
      isAllowedCanvasHost: () => true,
      normalizeDomainPattern: (domain) => domain
    },
    CanvasDomainSettings: {
      getConfiguredCanvasDomains: async () => []
    },
    CanvasActivePageCollector: {
      collectCurrentActivePageContext: async () => ({})
    },
    CanvasLocalProfileSettings: {
      getOrCreateLocalProfileId: async () => localProfileId
    },
    chrome: {
      contextMenus: {
        create: () => {},
        onClicked: { addListener: () => {} },
        remove: async () => {}
      },
      runtime: {
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: () => {} }
      },
      scripting: {
        executeScript: async () => {}
      },
      sidePanel: {
        open: async () => {},
        setPanelBehavior: async () => {}
      },
      tabs: {
        query: async () => []
      }
    }
  };

  runInNewContext(source, context);

  return context.CanvasGptBackground;
}

describe("background course material identity fallback", () => {
  it("adds a persisted local profile id to course material collection messages", async () => {
    const helpers = loadBackgroundIdentityHelpers("local_profile_abc");

    await expect(helpers.createCourseCollectionMessage("GET_CANVAS_COURSE_MATERIALS")).resolves.toEqual({
      type: "GET_CANVAS_COURSE_MATERIALS",
      localProfileId: "local_profile_abc"
    });
  });

  it("adds a persisted local profile id to direct manifest collection messages", async () => {
    const helpers = loadBackgroundIdentityHelpers("local_profile_abc");

    await expect(helpers.createCourseCollectionMessage("GET_CANVAS_COURSE_MANIFEST")).resolves.toEqual({
      type: "GET_CANVAS_COURSE_MANIFEST",
      localProfileId: "local_profile_abc"
    });
  });

  it("posts a collected course manifest to the local course-index prepare endpoint", async () => {
    const requests = [];
    const helpers = loadBackgroundIdentityHelpers("local_profile_abc", async (url, options) => {
      requests.push({ url, options });

      return {
        ok: true,
        json: async () => ({
          courseIndexId: "course_abc",
          consentRequired: true,
          consentGranted: false,
          vectorStoreStatus: "not_created",
          syncPlan: {
            newCount: 1,
            changedCount: 0,
            unchangedCount: 0,
            staleCount: 0,
            skippedCount: 0,
            new: ["assignment:77"],
            changed: [],
            unchanged: [],
            stale: [],
            skipped: []
          },
          warnings: []
        })
      };
    });
    const manifest = {
      canvasOrigin: "https://canvas.example.edu",
      courseId: "12345",
      localProfileId: "local_profile_abc",
      materials: [{ materialKey: "assignment:77", kind: "assignment" }],
      placements: []
    };

    await expect(helpers.prepareCourseIndex(manifest)).resolves.toMatchObject({
      courseIndexId: "course_abc"
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("http://localhost:8000/course-index/prepare");
    expect(requests[0].options.method).toBe("POST");
    expect(requests[0].options.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(requests[0].options.body)).toEqual({ manifest });
  });

  it("passes material policy metadata through for backend-authoritative storage decisions", async () => {
    const requests = [];
    const helpers = loadBackgroundIdentityHelpers("local_profile_abc", async (url, options) => {
      requests.push({ url, options });

      return {
        ok: true,
        json: async () => ({
          courseIndexId: "course_abc",
          consentRequired: true,
          consentGranted: false,
          vectorStoreStatus: "not_created",
          syncPlan: {
            newCount: 1,
            changedCount: 0,
            unchangedCount: 0,
            staleCount: 0,
            skippedCount: 1,
            new: ["assignment:725371"],
            changed: [],
            unchanged: [],
            stale: [],
            skipped: [
              {
                materialKey: "file:zip",
                title: "Archive",
                reason: "unsupported_file_type",
                message: "Material content type or file extension is not supported for indexing."
              }
            ]
          },
          warnings: [
            {
              materialKey: "file:zip",
              title: "Archive",
              reason: "unsupported_file_type",
              message: "Material content type or file extension is not supported for indexing."
            }
          ]
        })
      };
    });
    const manifest = {
      canvasOrigin: "https://canvas.example.edu",
      courseId: "12345",
      localProfileId: "local_profile_abc",
      materials: [
        {
          materialKey: "assignment:725371",
          kind: "assignment",
          title: "Homework #7",
          contentType: "",
          supportedForIndexing: false
        },
        {
          materialKey: "file:zip",
          kind: "file",
          title: "Archive",
          contentType: "application/zip",
          fileName: "archive.zip",
          supportedForIndexing: true
        }
      ],
      placements: []
    };

    await expect(helpers.prepareCourseIndex(manifest)).resolves.toMatchObject({
      courseIndexId: "course_abc",
      syncPlan: {
        newCount: 1,
        skippedCount: 1
      }
    });
    expect(JSON.parse(requests[0].options.body)).toEqual({ manifest });
  });

  it("posts vector store setup requests to the local backend", async () => {
    const requests = [];
    const helpers = loadBackgroundIdentityHelpers("local_profile_abc", async (url, options) => {
      requests.push({ url, options });

      return {
        ok: true,
        json: async () => ({
          courseIndexId: "course_abc",
          vectorStoreId: "vs_abc",
          vectorStoreStatus: "pending",
          action: "created",
          expiresAt: "2026-06-16T12:00:00+00:00",
          lastActiveAt: "2026-06-09T12:00:00+00:00"
        })
      };
    });

    await expect(helpers.setupCourseVectorStore("course_abc", true)).resolves.toMatchObject({
      vectorStoreId: "vs_abc",
      action: "created"
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("http://localhost:8000/course-index/vector-store");
    expect(requests[0].options.method).toBe("POST");
    expect(JSON.parse(requests[0].options.body)).toEqual({
      courseIndexId: "course_abc",
      consentGranted: true
    });
  });
});
