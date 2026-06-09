(function attachCanvasManifestUrl(root, factory) {
  const api = factory(root);

  if (root?.window) {
    root.window.CanvasManifestUrl = api;
  } else if (root) {
    root.CanvasManifestUrl = api;
  }

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createCanvasManifestUrl(root) {
  const TRACKING_PARAMS = new Set([
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
    "msclkid",
    "utm_campaign",
    "utm_content",
    "utm_id",
    "utm_medium",
    "utm_source",
    "utm_term"
  ]);
  const REDIRECT_PARAM_NAMES = ["url", "redirect_url", "return_to", "target", "destination"];
  const REDIRECT_PATH_PATTERNS = [
    /(^|\/)redirects?\/?$/i,
    /(^|\/)login\/canvas\/?$/i,
    /(^|\/)external_tools\/retrieve\/?$/i
  ];

  function getBrowserOrigin() {
    return root?.window?.location?.origin || root?.location?.origin || "";
  }

  function createUrl(value, baseOrigin) {
    if (!value) {
      return null;
    }

    try {
      const baseUrl = baseOrigin || getBrowserOrigin();

      return baseUrl ? new URL(String(value), baseUrl) : new URL(String(value));
    } catch {
      return null;
    }
  }

  function normalizeCanvasOrigin(canvasOrigin) {
    const originUrl = createUrl(canvasOrigin || getBrowserOrigin());

    if (!originUrl || !/^https?:$/.test(originUrl.protocol)) {
      return "";
    }

    return originUrl.origin;
  }

  function hasSameCanvasOrigin(url, canvasOrigin) {
    const normalizedOrigin = normalizeCanvasOrigin(canvasOrigin);

    return Boolean(normalizedOrigin && url?.origin === normalizedOrigin);
  }

  function isCurrentCanvasOriginUrl(value, canvasOrigin) {
    const url = createUrl(value, normalizeCanvasOrigin(canvasOrigin));

    return hasSameCanvasOrigin(url, canvasOrigin);
  }

  function isCanvasRedirectPath(pathname) {
    return REDIRECT_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
  }

  function getRedirectTarget(url) {
    if (!isCanvasRedirectPath(url.pathname)) {
      return null;
    }

    for (const name of REDIRECT_PARAM_NAMES) {
      const value = url.searchParams.get(name);

      if (value) {
        return value;
      }
    }

    return null;
  }

  function unwrapCanvasRedirectUrl(value, canvasOrigin) {
    const normalizedOrigin = normalizeCanvasOrigin(canvasOrigin);
    const url = createUrl(value, normalizedOrigin);

    if (!hasSameCanvasOrigin(url, normalizedOrigin)) {
      return null;
    }

    const targetValue = getRedirectTarget(url);

    if (!targetValue) {
      return url;
    }

    const targetUrl = createUrl(targetValue, normalizedOrigin);

    if (!hasSameCanvasOrigin(targetUrl, normalizedOrigin)) {
      return null;
    }

    return targetUrl;
  }

  function removeTrackingParams(url) {
    Array.from(url.searchParams.keys()).forEach((key) => {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    });
  }

  function removeSafeTrailingSlash(pathname) {
    if (pathname === "/") {
      return "";
    }

    return pathname.replace(/\/+$/, "");
  }

  function formatNormalizedUrl(url) {
    const pathname = removeSafeTrailingSlash(url.pathname);

    return `${url.origin}${pathname}${url.search}`;
  }

  function normalizeCanvasUrl(value, canvasOrigin) {
    const normalizedOrigin = normalizeCanvasOrigin(canvasOrigin);
    const url = unwrapCanvasRedirectUrl(value, normalizedOrigin);

    if (!hasSameCanvasOrigin(url, normalizedOrigin)) {
      return null;
    }

    url.hash = "";
    removeTrackingParams(url);

    return formatNormalizedUrl(url);
  }

  return {
    isCurrentCanvasOriginUrl,
    normalizeCanvasOrigin,
    normalizeCanvasUrl,
    unwrapCanvasRedirectUrl
  };
});
