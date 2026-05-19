(function initCanvasDetection(globalScope) {
  const DEFAULT_CANVAS_DOMAIN_PATTERNS = ["*.instructure.com", "canvas.case.edu"];
  const CANVAS_ROUTE_PATTERNS = [
    ["syllabus", /\/assignments\/syllabus(?:\/)?$/],
    ["assignment", /\/assignments\/\d+/],
    ["module_item", /\/modules\/items\/\d+/],
    ["modules", /\/modules(?:\/)?/],
    ["page", /\/pages\//],
    ["discussion", /\/discussion_topics\/\d+/],
    ["announcement", /\/announcements\/\d+/],
    ["file", /\/files\/\d+/],
    ["quiz", /\/quizzes\/\d+/],
    ["course_home", /\/courses\/\d+(?:\/)?$/]
  ];
  const PUBLIC_SUFFIX_WILDCARD_DENYLIST = new Set([
    "com",
    "net",
    "org",
    "edu",
    "gov",
    "mil",
    "io",
    "ai",
    "app",
    "dev",
    "co",
    "uk",
    "co.uk",
    "ac.uk",
    "gov.uk",
    "com.au",
    "com.br",
    "co.in",
    "co.jp",
    "co.nz"
  ]);
  const CANVAS_DOM_MARKERS = [
    "#content",
    ".ic-app",
    ".ic-Layout-wrapper",
    ".course-title",
    ".assignment-title",
    ".module-item-title"
  ];

  function normalizeHostname(hostname = "") {
    return String(hostname).trim().toLowerCase();
  }

  function normalizeDomainPattern(domain = "") {
    return normalizeHostname(domain)
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
  }

  function getDomainLabels(hostname) {
    return normalizeHostname(hostname).split(".").filter(Boolean);
  }

  function isValidHostname(hostname) {
    const normalizedHost = normalizeHostname(hostname);
    const labels = getDomainLabels(normalizedHost);

    return (
      normalizedHost.length <= 253 &&
      labels.length >= 2 &&
      labels.join(".") === normalizedHost &&
      labels.every(
        (label) =>
          label.length <= 63 &&
          /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
      )
    );
  }

  function validateDomainPattern(domain = "") {
    const normalizedPattern = normalizeDomainPattern(domain);

    if (!normalizedPattern) {
      return { valid: false, error: "Enter a Canvas hostname." };
    }

    if (
      normalizedPattern.includes(":") ||
      (normalizedPattern.includes("*") && !normalizedPattern.startsWith("*."))
    ) {
      return { valid: false, error: "Use a hostname like school.instructure.com or *.school.edu." };
    }

    if (normalizedPattern.startsWith("*.")) {
      const suffix = normalizedPattern.slice(2);

      if (!isValidHostname(suffix)) {
        return { valid: false, error: "Wildcard Canvas domains must include a real organization domain." };
      }

      if (PUBLIC_SUFFIX_WILDCARD_DENYLIST.has(suffix)) {
        return { valid: false, error: "Wildcard Canvas domains cannot target a public suffix." };
      }

      return { valid: true, value: normalizedPattern };
    }

    if (!isValidHostname(normalizedPattern)) {
      return { valid: false, error: "Use a valid Canvas hostname like school.instructure.com." };
    }

    return { valid: true, value: normalizedPattern };
  }

  function getDefaultCanvasDomainPatterns() {
    return [...DEFAULT_CANVAS_DOMAIN_PATTERNS];
  }

  function isDomainPatternMatch(hostname, pattern) {
    const normalizedHost = normalizeHostname(hostname);
    const normalizedPattern = normalizeDomainPattern(pattern);

    if (!normalizedHost || !normalizedPattern) {
      return false;
    }

    if (normalizedPattern.startsWith("*.")) {
      const suffix = normalizedPattern.slice(2);
      return normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`);
    }

    return normalizedHost === normalizedPattern;
  }

  function isAllowedCanvasHost(hostname, configuredDomains = []) {
    const patterns = [
      ...DEFAULT_CANVAS_DOMAIN_PATTERNS,
      ...configuredDomains.map(normalizeDomainPattern)
    ];

    return patterns.some((pattern) => isDomainPatternMatch(hostname, pattern));
  }

  function parseCanvasRoute(url, configuredDomains = []) {
    let parsed;

    try {
      parsed = new URL(url);
    } catch {
      return null;
    }

    if (!isAllowedCanvasHost(parsed.hostname, configuredDomains)) {
      return null;
    }

    const courseMatch = parsed.pathname.match(/\/courses\/(\d+)/);
    if (!courseMatch) {
      return {
        courseId: "",
        route: "unknown",
        url: parsed.toString(),
        hostname: parsed.hostname,
        isCanvas: true
      };
    }

    const courseId = courseMatch[1];
    const pathname = parsed.pathname;
    const route =
      CANVAS_ROUTE_PATTERNS.find(([, pattern]) => pattern.test(pathname))?.[0] || "unknown";

    return {
      courseId,
      route,
      url: parsed.toString(),
      hostname: parsed.hostname,
      isCanvas: true
    };
  }

  function detectCanvasDom(doc = globalScope.document) {
    if (!doc) {
      return false;
    }

    return (
      CANVAS_DOM_MARKERS.some((selector) => Boolean(doc.querySelector(selector))) ||
      Array.from(doc.querySelectorAll("link[href], script[src]")).some((element) => {
        const assetUrl = element.getAttribute("href") || element.getAttribute("src") || "";
        return /canvas|instructure/i.test(assetUrl);
      })
    );
  }

  globalScope.CanvasDetection = {
    getDefaultCanvasDomainPatterns,
    isAllowedCanvasHost,
    parseCanvasRoute,
    detectCanvasDom,
    normalizeDomainPattern,
    validateDomainPattern
  };
})(globalThis);
