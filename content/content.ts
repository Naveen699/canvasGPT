const MAX_VISIBLE_TEXT_LENGTH = 10000;

type LinkItem = {
  text: string;
  href: string;
};

function getTrimmedText(element: Element | null | undefined): string {
  return (element as HTMLElement | null | undefined)?.innerText?.trim() || element?.textContent?.trim() || "";
}

function getUniqueItems<T>(items: T[], keyFn: (item: T) => string): T[] {
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

function extractLinks(selector = "a"): LinkItem[] {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(selector))
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
    .map((element: Element) => ({
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

chrome.runtime.onMessage.addListener((message: { type?: string }, sender, sendResponse) => {
  if (message.type === "EXTRACT_PAGE_DATA") {
    try {
      sendResponse({ success: true, data: extractPageData() });
    } catch (error) {
      sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
    }

    return true;
  }

  if (message.type === "CHECK_CANVAS_PAGE") {
    try {
      sendResponse({ success: true, data: getCanvasPageVerification() });
    } catch (error) {
      sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
    }

    return true;
  }

  if (message.type === "GET_CANVAS_COURSE_MATERIALS") {
    if (!window.CanvasSessionApi?.getCurrentCanvasCourseMaterials) {
      sendResponse({ success: false, error: "Canvas API client is not loaded." });
      return true;
    }

    window.CanvasSessionApi.getCurrentCanvasCourseMaterials()
      .then((data: unknown) => sendResponse({ success: true, data }))
      .catch((error: Error) => sendResponse({ success: false, error: error.message }));

    return true;
  }

  return false;
});
