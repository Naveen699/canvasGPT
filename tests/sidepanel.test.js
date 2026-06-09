import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function createElement() {
  return {
    append: () => {},
    addEventListener: () => {},
    removeChild: () => {},
    className: "",
    disabled: false,
    firstChild: null,
    hidden: false,
    innerHTML: "",
    textContent: ""
  };
}

function loadSidepanelHelpers() {
  const source = readFileSync(resolve("sidepanel/sidepanel.js"), "utf8");
  const elements = new Map();
  const context = {
    __CANVASGPT_TEST__: true,
    chrome: {
      runtime: {
        lastError: null,
        sendMessage: (_message, callback) => callback({ success: true, data: {} })
      }
    },
    document: {
      createElement,
      getElementById(id) {
        if (!elements.has(id)) {
          elements.set(id, createElement());
        }

        return elements.get(id);
      }
    },
    fetch,
    globalThis: null
  };
  context.globalThis = context;

  runInNewContext(source, context);

  return context.CanvasGptSidepanel;
}

describe("sidepanel sync material selection", () => {
  it("includes unchanged materials when a vector store was just created", () => {
    const helpers = loadSidepanelHelpers();
    const manifest = {
      materials: [
        { materialKey: "page:overview", kind: "page" },
        { materialKey: "file:slides", kind: "file" },
        { materialKey: "file:skipped", kind: "file" }
      ]
    };
    const syncPlan = {
      new: [],
      changed: [],
      unchanged: ["page:overview", "file:slides", "file:skipped"],
      skipped: [{ materialKey: "file:skipped" }]
    };

    expect(helpers.shouldSyncUnchangedMaterials({
      action: "created",
      vectorStoreStatus: "pending"
    })).toBe(true);
    expect(helpers.getMaterialsForSync(manifest, syncPlan)).toEqual([]);
    expect(
      helpers.getMaterialsForSync(manifest, syncPlan, { includeUnchanged: true })
    ).toEqual([
      { materialKey: "page:overview", kind: "page" },
      { materialKey: "file:slides", kind: "file" }
    ]);
  });

  it("keeps Canvas signed-file resolver warnings with backend sync warnings", () => {
    const helpers = loadSidepanelHelpers();

    expect(
      helpers.mergeSyncWarnings(
        {
          syncStatus: "ready",
          warnings: [{ reason: "vector_store_pending", message: "Still processing." }]
        },
        [
          {
            materialKey: "file:blocked",
            reason: "canvas_file_access_failed",
            message: "Canvas API returned 403: user not authorized to perform that action"
          }
        ]
      )
    ).toEqual({
      syncStatus: "ready",
      warnings: [
        { reason: "vector_store_pending", message: "Still processing." },
        {
          materialKey: "file:blocked",
          reason: "canvas_file_access_failed",
          message: "Canvas API returned 403: user not authorized to perform that action"
        }
      ]
    });
  });
});
