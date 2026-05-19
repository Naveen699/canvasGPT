import { parseCanvasPage, type CanvasContextDoc, type CanvasRoute } from "../parse";
import {
  chunkDocuments,
  retrieveCanvasChunks,
  type CanvasChunk,
  type RetrievalOptions,
  type RetrievalResult
} from "../retrieval";
import { RAW_HTML_LIFECYCLE_TRANSIENT } from "./types";

const MAX_TEXT_LENGTH = 60000;

type RawCanvasPage = {
  url: string;
  title: string;
  html: string;
  text: string;
  contentType: string;
};

type CanvasRouteInfo = {
  courseId?: string;
  route?: CanvasRoute;
};

type ActivePageContextOptions = RetrievalOptions & {
  query?: string;
};

function normalizeText(text = ""): string {
  return String(text).replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractTitleFromHtml(html = ""): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  return document.title || "";
}

function extractTextFromHtml(html = ""): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("script, style").forEach((element) => element.remove());
  return document.body?.textContent || "";
}

function isRawCanvasPage(value: unknown): value is RawCanvasPage {
  const rawPage = value as Partial<RawCanvasPage>;

  return Boolean(
    rawPage &&
      typeof rawPage.url === "string" &&
      typeof rawPage.title === "string" &&
      typeof rawPage.html === "string" &&
      typeof rawPage.text === "string" &&
      typeof rawPage.contentType === "string"
  );
}

function parseHtmlDocument(rawPage: RawCanvasPage): Document {
  const document = new DOMParser().parseFromString(rawPage.html, "text/html");

  if (!document.title && rawPage.title) {
    document.title = rawPage.title;
  }

  return document;
}

export function retrieveActivePageChunks(
  query: string,
  docs: CanvasContextDoc[],
  options: RetrievalOptions = {}
): RetrievalResult {
  return retrieveCanvasChunks(query, docs, options);
}

function createDefaultChunks(docs: CanvasContextDoc[], options: RetrievalOptions = {}): CanvasChunk[] {
  return chunkDocuments(docs, options).slice(0, options.maxChunks ?? 8);
}

export function parseRawActiveCanvasPage(
  rawPage: RawCanvasPage,
  routeInfo: CanvasRouteInfo | null = null,
  options: ActivePageContextOptions = {}
) {
  const rawHtml = rawPage.html;
  const document = parseHtmlDocument(rawPage);
  const text = normalizeText(rawPage.text || extractTextFromHtml(rawHtml));
  const title = rawPage.title || extractTitleFromHtml(rawHtml) || rawPage.url;
  const collectedAt = Date.now();
  const docs = parseCanvasPage({
    document,
    url: rawPage.url,
    title,
    courseId: routeInfo?.courseId || undefined,
    route: routeInfo?.route,
    collectedAt
  });
  const retrieval = options.query
    ? retrieveActivePageChunks(options.query, docs, {
        ...options,
        currentUrl: options.currentUrl || rawPage.url
      })
    : null;
  const chunks = retrieval?.chunks || createDefaultChunks(docs, options);

  return {
    url: rawPage.url,
    title,
    text: text.slice(0, MAX_TEXT_LENGTH),
    contentType: rawPage.contentType || "text/html",
    routeInfo,
    collectedAt: new Date(collectedAt).toISOString(),
    rawHtmlLifecycle: RAW_HTML_LIFECYCLE_TRANSIENT,
    rawHtmlBytes: rawHtml.length,
    docs,
    chunks,
    retrieval
  };
}

export async function collectActiveCanvasPage(tabId: number): Promise<RawCanvasPage> {
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

  if (!isRawCanvasPage(rawPage)) {
    throw new Error("Canvas page collection returned an unexpected result.");
  }

  return rawPage;
}

export async function collectCurrentActivePageContext(
  tabId: number,
  routeInfo: CanvasRouteInfo | null = null,
  options: ActivePageContextOptions = {}
) {
  const rawPage = await collectActiveCanvasPage(tabId);

  try {
    return parseRawActiveCanvasPage(rawPage, routeInfo, options);
  } finally {
    rawPage.html = "";
  }
}
