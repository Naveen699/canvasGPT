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

  it("resolves selected file materials through same-origin Canvas APIs", async () => {
    const requests = [];
    const api = loadCanvasApiClient(async (url, options) => {
      requests.push({ url, options });

      if (url === "https://canvas.example.edu/api/v1/courses/12345?include%5B%5D=term&include%5B%5D=course_image") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => "" },
          text: async () =>
            JSON.stringify({
              id: "12345",
              name: "Biology",
              workflow_state: "available"
            })
        };
      }

      if (url === "https://canvas.example.edu/api/v1/files/987") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => "" },
          text: async () =>
            JSON.stringify({
              id: "987",
              filename: "lecture.pdf",
              "content-type": "application/pdf",
              size: 2048
            })
        };
      }

      if (url === "https://canvas.example.edu/api/v1/files/987/public_url") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => "" },
          text: async () =>
            JSON.stringify({
              public_url: "https://canvas.example.edu/files/987/download?verifier=secret"
            })
        };
      }

      throw new Error(`Unexpected request ${url}`);
    });

    await expect(
      api.resolveSignedFilesForCourseMaterials({
        canvasOrigin: "https://canvas.example.edu",
        courseId: "12345",
        materials: [{ materialKey: "file:987", kind: "file" }]
      })
    ).resolves.toEqual({
      signedFiles: [
        {
          materialKey: "file:987",
          fileId: "987",
          fileName: "lecture.pdf",
          contentType: "application/pdf",
          size: 2048,
          signedUrl: "https://canvas.example.edu/files/987/download?verifier=secret"
        }
      ],
      warnings: []
    });

    expect(requests.map((request) => request.url)).toEqual([
      "https://canvas.example.edu/api/v1/courses/12345?include%5B%5D=term&include%5B%5D=course_image",
      "https://canvas.example.edu/api/v1/files/987",
      "https://canvas.example.edu/api/v1/files/987/public_url"
    ]);
    requests.forEach((request) => {
      expect(new URL(request.url).origin).toBe("https://canvas.example.edu");
      expect(request.options).toEqual({
        credentials: "same-origin",
        headers: {
          Accept: "application/json+canvas-string-ids"
        }
      });
    });
  });

  it("refuses to resolve signed files when the active course changed", async () => {
    const requests = [];
    const api = loadCanvasApiClient(async (url, options) => {
      requests.push({ url, options });
      throw new Error("fetch should not be called");
    });

    await expect(
      api.resolveSignedFilesForCourseMaterials({
        canvasOrigin: "https://canvas.example.edu",
        courseId: "99999",
        materials: [{ materialKey: "file:987", kind: "file" }]
      })
    ).rejects.toThrow("expected course");
    expect(requests).toEqual([]);
  });

  it("returns warnings instead of failing the whole resolver for inaccessible files", async () => {
    const api = loadCanvasApiClient(async (url) => {
      if (url === "https://canvas.example.edu/api/v1/courses/12345?include%5B%5D=term&include%5B%5D=course_image") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => "" },
          text: async () =>
            JSON.stringify({
              id: "12345",
              name: "Biology",
              workflow_state: "available"
            })
        };
      }

      if (url === "https://canvas.example.edu/api/v1/files/987") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => "" },
          text: async () =>
            JSON.stringify({
              id: "987",
              filename: "lecture.pdf",
              "content-type": "application/pdf",
              size: 2048
            })
        };
      }

      if (url === "https://canvas.example.edu/api/v1/files/987/public_url") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => "" },
          text: async () =>
            JSON.stringify({
              public_url: "https://canvas.example.edu/files/987/download?verifier=secret"
            })
        };
      }

      if (url === "https://canvas.example.edu/api/v1/files/blocked") {
        return {
          ok: false,
          status: 403,
          statusText: "Forbidden",
          headers: { get: () => "" },
          text: async () =>
            JSON.stringify({
              message: "user not authorized to perform that action"
            })
        };
      }

      throw new Error(`Unexpected request ${url}`);
    });

    await expect(
      api.resolveSignedFilesForCourseMaterials({
        canvasOrigin: "https://canvas.example.edu",
        courseId: "12345",
        materials: [
          { materialKey: "file:987", kind: "file" },
          { materialKey: "file:blocked", kind: "file", title: "Blocked file" }
        ]
      })
    ).resolves.toEqual({
      signedFiles: [
        {
          materialKey: "file:987",
          fileId: "987",
          fileName: "lecture.pdf",
          contentType: "application/pdf",
          size: 2048,
          signedUrl: "https://canvas.example.edu/files/987/download?verifier=secret"
        }
      ],
      warnings: [
        {
          materialKey: "file:blocked",
          title: "Blocked file",
          reason: "canvas_file_access_failed",
          message: "Canvas API returned 403: user not authorized to perform that action"
        }
      ]
    });
  });
});
