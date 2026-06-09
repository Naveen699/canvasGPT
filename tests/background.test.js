import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function loadBackgroundIdentityHelpers(localProfileId = "local_profile_fallback") {
  const source = readFileSync(resolve("background.js"), "utf8");
  const context = {
    __CANVASGPT_TEST__: true,
    console,
    fetch,
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
});
