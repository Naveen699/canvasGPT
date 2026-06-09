import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function loadCanvasApiClient(fetch) {
  const source = readFileSync(resolve("content/canvasApiClient.js"), "utf8");
  const window = {
    location: {
      origin: "https://canvas.example.edu",
      pathname: "/courses/12345"
    }
  };
  const context = {
    DOMParser: class {
      parseFromString() {
        return { querySelectorAll: () => [] };
      }
    },
    URL,
    document: {
      querySelectorAll: () => []
    },
    fetch,
    window
  };

  runInNewContext(source, context);

  return window.CanvasSessionApi;
}

describe("CanvasSessionApiClient", () => {
  it("loads the current Canvas user profile from the same origin", async () => {
    const requests = [];
    const api = loadCanvasApiClient(async (url, options) => {
      requests.push({ url, options });

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: {
          get: () => ""
        },
        text: async () => JSON.stringify({ id: 67890 })
      };
    });
    const client = new api.CanvasSessionApiClient();

    await expect(client.getCurrentUserProfile()).resolves.toEqual({ id: 67890 });
    expect(requests).toEqual([
      {
        url: "https://canvas.example.edu/api/v1/users/self/profile",
        options: {
          credentials: "same-origin",
          headers: {
            Accept: "application/json+canvas-string-ids"
          }
        }
      }
    ]);
  });
});
