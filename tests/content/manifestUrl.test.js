import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import manifestUrl from "../../content/manifestUrl.js";

const CANVAS_ORIGIN = "https://canvas.example.edu";

describe("CanvasManifestUrl", () => {
  it("exports helpers for module tests", () => {
    expect(manifestUrl).toMatchObject({
      isCurrentCanvasOriginUrl: expect.any(Function),
      normalizeCanvasOrigin: expect.any(Function),
      normalizeCanvasUrl: expect.any(Function),
      unwrapCanvasRedirectUrl: expect.any(Function)
    });
  });

  it("attaches helpers to window when loaded as a browser script", () => {
    const source = readFileSync(resolve("content/manifestUrl.js"), "utf8");
    const window = { location: { origin: CANVAS_ORIGIN } };
    const context = {
      URL,
      window
    };

    runInNewContext(source, context);

    expect(window.CanvasManifestUrl.normalizeCanvasUrl("/courses/123/", CANVAS_ORIGIN)).toBe(
      "https://canvas.example.edu/courses/123"
    );
  });

  it("normalizes current-origin Canvas URLs", () => {
    expect(
      manifestUrl.normalizeCanvasUrl(
        "https://CANVAS.EXAMPLE.EDU/courses/123/pages/week-1/#overview",
        CANVAS_ORIGIN
      )
    ).toBe("https://canvas.example.edu/courses/123/pages/week-1");
  });

  it("resolves relative Canvas URLs against the current origin", () => {
    expect(manifestUrl.normalizeCanvasUrl("/courses/123/assignments/77/", CANVAS_ORIGIN)).toBe(
      "https://canvas.example.edu/courses/123/assignments/77"
    );
  });

  it("keeps non-tracking query parameters", () => {
    expect(
      manifestUrl.normalizeCanvasUrl(
        "/courses/123/files/456?download_frd=1&verifier=abc",
        CANVAS_ORIGIN
      )
    ).toBe("https://canvas.example.edu/courses/123/files/456?download_frd=1&verifier=abc");
  });

  it("removes conservative tracking query parameters", () => {
    expect(
      manifestUrl.normalizeCanvasUrl(
        "/courses/123/pages/week-1?utm_source=email&utm_medium=school&module_item_id=9&fbclid=abc",
        CANVAS_ORIGIN
      )
    ).toBe("https://canvas.example.edu/courses/123/pages/week-1?module_item_id=9");
  });

  it("excludes external links", () => {
    expect(manifestUrl.normalizeCanvasUrl("https://example.com/courses/123", CANVAS_ORIGIN)).toBe(
      null
    );
  });

  it("unwraps Canvas redirect URLs when the target stays on the current origin", () => {
    const target = encodeURIComponent(
      "https://canvas.example.edu/courses/123/pages/week-1?utm_campaign=x#heading"
    );

    expect(
      manifestUrl.normalizeCanvasUrl(`/login/canvas?return_to=${target}`, CANVAS_ORIGIN)
    ).toBe("https://canvas.example.edu/courses/123/pages/week-1");
  });

  it("excludes Canvas redirect URLs to external targets", () => {
    const target = encodeURIComponent("https://example.com/phishing");

    expect(
      manifestUrl.normalizeCanvasUrl(`/login/canvas?return_to=${target}`, CANVAS_ORIGIN)
    ).toBe(null);
  });

  it("does not unwrap ordinary Canvas URLs with url query parameters", () => {
    const target = encodeURIComponent("https://canvas.example.edu/courses/123/pages/target");

    expect(
      manifestUrl.normalizeCanvasUrl(`/courses/123/pages/source?url=${target}`, CANVAS_ORIGIN)
    ).toBe(
      "https://canvas.example.edu/courses/123/pages/source?url=https%3A%2F%2Fcanvas.example.edu%2Fcourses%2F123%2Fpages%2Ftarget"
    );
  });

  it("recognizes only the configured current Canvas origin", () => {
    expect(
      manifestUrl.isCurrentCanvasOriginUrl(
        "https://other-canvas.example.edu/courses/123",
        CANVAS_ORIGIN
      )
    ).toBe(false);
  });
});
