import {
  CanvasContextDoc,
  CanvasLinkMetadata,
  CanvasParseInput,
  absolutizeUrl,
  createDoc,
  extractLinkedFiles,
  extractReadableText,
  getBaseParsedPage,
  getTrimmedText,
  hashSource,
  selectMainContent,
  slugify,
  uniqueBy
} from "./base";

function extractEmbeddedIframes(document: Document, baseUrl: string): CanvasLinkMetadata[] {
  return uniqueBy(
    Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe[src]"))
      .map((iframe) => ({
        title: iframe.getAttribute("title") || iframe.getAttribute("aria-label") || "Embedded content",
        url: absolutizeUrl(iframe.getAttribute("src"), baseUrl),
        type: "iframe"
      }))
      .filter((iframe) => iframe.url),
    (iframe) => `${iframe.title}:${iframe.url}`
  );
}

export function parsePage(input: CanvasParseInput): CanvasContextDoc[] {
  const base = getBaseParsedPage(input);
  const pageRoot =
    input.document.querySelector(".show-content .user_content") ||
    input.document.querySelector(".wiki-page-body") ||
    input.document.querySelector(".user_content") ||
    selectMainContent(input.document);
  const title =
    getTrimmedText(input.document.querySelector(".page-title, .wiki-page-title, h1")) ||
    base.title;
  const text = extractReadableText(pageRoot);

  return [
    createDoc({
      id: `${base.courseId || "canvas"}:page:${slugify(title)}:${hashSource(input.url)}`,
      courseId: base.courseId,
      route: "page",
      type: "page",
      title,
      url: input.url,
      text,
      collectedAt: base.collectedAt,
      metadata: {
        linkedFiles: extractLinkedFiles(input.document, input.url),
        embeddedIframes: extractEmbeddedIframes(input.document, input.url),
        sourceHash: hashSource(`${input.url}\n${title}\n${text}`)
      }
    })
  ];
}
