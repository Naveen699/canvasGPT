const MAX_VISIBLE_TEXT_LENGTH = 10000;

function getTrimmedText(element) {
  return element?.innerText?.trim() || element?.textContent?.trim() || "";
}

function getUniqueItems(items, keyFn) {
  const seen = new Set();

  return items.filter((item) => {
    const key = keyFn(item);

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function extractHeadings() {
  return Array.from(document.querySelectorAll("h1, h2, h3"))
    .map(getTrimmedText)
    .filter(Boolean);
}

function extractLinks(selector = "a") {
  const links = Array.from(document.querySelectorAll(selector))
    .map((link) => ({
      text: getTrimmedText(link),
      href: link.href
    }))
    .filter((link) => link.text || link.href);

  return getUniqueItems(links, (link) => `${link.text}:${link.href}`);
}

function extractCanvasItems() {
  const assignments = extractLinks("a[href*='/assignments/'], .ig-title a");
  const files = extractLinks("a[href*='/files/']");
  const modules = extractLinks("a[href*='/modules/']");

  const dueDates = Array.from(
    document.querySelectorAll("[class*='due'], time, [datetime]")
  )
    .map((element) => ({
      text: getTrimmedText(element),
      dateTime: element.getAttribute("datetime") || ""
    }))
    .filter((item) => item.text || item.dateTime);

  return {
    assignments,
    files,
    modules,
    dueDates: getUniqueItems(dueDates, (item) => `${item.text}:${item.dateTime}`)
  };
}

function getCanvasPageDetection() {
  const routeInfo =
    window.CanvasDetection?.parseCanvasRoute(window.location.href, [window.location.hostname]) ||
    null;

  return {
    routeInfo,
    isCanvasDom: Boolean(window.CanvasDetection?.detectCanvasDom(document))
  };
}

function extractPageData() {
  const visibleText = document.body?.innerText || "";
  const detection = getCanvasPageDetection();

  return {
    url: window.location.href,
    title: document.title,
    ...detection,
    headings: extractHeadings(),
    links: extractLinks(),
    canvas: extractCanvasItems(),
    visibleText: visibleText.slice(0, MAX_VISIBLE_TEXT_LENGTH)
  };
}

function getCanvasPageVerification() {
  return getCanvasPageDetection();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXTRACT_PAGE_DATA") {
    try {
      sendResponse({ success: true, data: extractPageData() });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }

    return true;
  }

  if (message.type === "CHECK_CANVAS_PAGE") {
    try {
      sendResponse({ success: true, data: getCanvasPageVerification() });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }

    return true;
  }

  if (message.type === "GET_CANVAS_COURSE_MATERIALS") {
    if (!window.CanvasSessionApi?.getCurrentCanvasCourseMaterials) {
      sendResponse({ success: false, error: "Canvas API client is not loaded." });
      return true;
    }

    window.CanvasSessionApi.getCurrentCanvasCourseMaterials()
      .then((data) => {
        const manifest = window.CanvasManifestBuilder?.buildManifest
          ? window.CanvasManifestBuilder.buildManifest(data)
          : null;

        sendResponse({ success: true, data: { ...data, manifest } });
      })
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true;
  }

  return false;
});
