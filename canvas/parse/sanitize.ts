const PRUNE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe[src*='youtube']",
  "nav",
  "header",
  "footer",
  "[hidden]",
  '[aria-hidden="true"]',
  ".hidden",
  ".sr-only",
  ".screenreader-only",
  ".ui-helper-hidden-accessible",
  "#left-side",
  "#right-side-wrapper",
  "#breadcrumbs",
  ".ic-app-nav-toggle-and-crumbs",
  ".ic-Layout-side",
  ".ic-Layout-watermark"
];

function isInlineHidden(element: Element): boolean {
  const style = element.getAttribute("style") || "";

  return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style);
}

export function sanitizeCanvasDocument(document: Document): Document {
  const clone = document.cloneNode(true) as Document;

  clone.querySelectorAll(PRUNE_SELECTORS.join(",")).forEach((element) => {
    element.remove();
  });

  clone.querySelectorAll("[style]").forEach((element) => {
    if (isInlineHidden(element)) {
      element.remove();
    }
  });

  return clone;
}

export function sanitizeCanvasInput<T extends { document: Document }>(input: T): T {
  return {
    ...input,
    document: sanitizeCanvasDocument(input.document)
  };
}
