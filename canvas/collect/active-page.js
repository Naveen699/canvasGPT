(function initCanvasActivePageCollector(globalScope) {
  const MAX_TEXT_LENGTH = 60000;

  function normalizeText(text = "") {
    return String(text).replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function decodeHtmlEntities(text = "") {
    const entities = {
      amp: "&",
      gt: ">",
      lt: "<",
      quot: '"',
      apos: "'"
    };

    return text.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (match, entity) => {
      if (entity[0] === "#") {
        const codePoint = entity[1].toLowerCase() === "x"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);

        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      }

      return entities[entity.toLowerCase()] || match;
    });
  }

  function extractTitleFromHtml(html = "") {
    const match = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match ? decodeHtmlEntities(match[1]).trim() : "";
  }

  function extractTextFromHtml(html = "") {
    return decodeHtmlEntities(
      String(html)
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
    );
  }

  function parseRawActiveCanvasPage(rawPage, routeInfo = null) {
    const rawHtml = rawPage.html;
    const text = normalizeText(rawPage.text || extractTextFromHtml(rawHtml));

    return {
      url: rawPage.url,
      title: rawPage.title || extractTitleFromHtml(rawHtml) || rawPage.url,
      text: text.slice(0, MAX_TEXT_LENGTH),
      contentType: rawPage.contentType || "text/html",
      routeInfo,
      collectedAt: new Date().toISOString(),
      rawHtmlLifecycle: globalScope.CanvasCollectTypes?.RAW_HTML_LIFECYCLE_TRANSIENT || "transient",
      rawHtmlBytes: rawHtml.length
    };
  }

  async function collectActiveCanvasPage(tabId) {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        url: window.location.href,
        title: document.title,
        html: document.documentElement?.outerHTML || "",
        text: document.body?.innerText || "",
        contentType: document.contentType || "text/html"
      })
    });

    const rawPage = result?.result;

    if (!globalScope.CanvasCollectTypes?.isRawCanvasPage(rawPage)) {
      throw new Error("Canvas page collection returned an unexpected result.");
    }

    return rawPage;
  }

  async function collectCurrentActivePageContext(tabId, routeInfo = null) {
    const rawPage = await collectActiveCanvasPage(tabId);

    try {
      return parseRawActiveCanvasPage(rawPage, routeInfo);
    } finally {
      rawPage.html = "";
    }
  }

  globalScope.CanvasActivePageCollector = {
    collectActiveCanvasPage,
    collectCurrentActivePageContext,
    parseRawActiveCanvasPage
  };
})(globalThis);
