export type CanvasRoute =
  | "assignment"
  | "module_item"
  | "modules"
  | "page"
  | "discussion"
  | "announcement"
  | "file"
  | "quiz"
  | "course_home"
  | "syllabus"
  | "unknown";

export type CanvasContextDocType =
  | "assignment"
  | "module"
  | "page"
  | "discussion"
  | "announcement"
  | "file"
  | "syllabus"
  | "rubric"
  | "unknown";

export type CanvasLinkMetadata = {
  title: string;
  url: string;
  type?: string;
  text?: string;
};

export type CanvasModuleItemMetadata = CanvasLinkMetadata & {
  itemType?: string;
  completionRequirement?: string;
  lockState?: string;
};

export type CanvasContextMetadata = {
  dueAt?: string;
  availableFrom?: string;
  availableUntil?: string;
  points?: string;
  author?: string;
  updatedAt?: string;
  submissionType?: string;
  moduleBreadcrumb?: string;
  collectedAt: number;
  sourceHash: string;
  linkedFiles?: CanvasLinkMetadata[];
  embeddedIframes?: CanvasLinkMetadata[];
  moduleItems?: CanvasModuleItemMetadata[];
  courseSummaryRows?: string[];
};

export type CanvasContextDoc = {
  id: string;
  courseId: string;
  route: CanvasRoute;
  type: CanvasContextDocType;
  title: string;
  url: string;
  text: string;
  metadata: CanvasContextMetadata;
};

export type CanvasParseInput = {
  document: Document;
  url: string;
  title?: string;
  courseId?: string;
  route?: CanvasRoute;
  collectedAt?: number;
};

export type BaseParsedPage = {
  courseId: string;
  route: CanvasRoute;
  title: string;
  url: string;
  text: string;
  sourceHash: string;
  collectedAt: number;
};

const MAIN_CONTENT_SELECTORS = [
  "#content",
  "main",
  '[role="main"]',
  ".ic-Layout-contentMain"
];

export function normalizeWhitespace(text = ""): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function getTrimmedText(element: Element | null | undefined): string {
  return normalizeWhitespace(element?.textContent || "");
}

export function absolutizeUrl(href: string | null | undefined, baseUrl: string): string {
  if (!href) {
    return "";
  }

  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

export function uniqueBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = keyFn(item);

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function inferCourseIdFromUrl(url: string): string {
  try {
    return new URL(url).pathname.match(/\/courses\/(\d+)/)?.[1] || "";
  } catch {
    return "";
  }
}

export function inferRouteFromUrl(url: string): CanvasRoute {
  try {
    const pathname = new URL(url).pathname;

    if (/\/assignments\/syllabus(?:\/)?$/.test(pathname)) return "syllabus";
    if (/\/assignments\/\d+/.test(pathname)) return "assignment";
    if (/\/modules\/items\/\d+/.test(pathname)) return "module_item";
    if (/\/modules(?:\/)?/.test(pathname)) return "modules";
    if (/\/pages\//.test(pathname)) return "page";
    if (/\/discussion_topics\/\d+/.test(pathname)) return "discussion";
    if (/\/announcements\/\d+/.test(pathname)) return "announcement";
    if (/\/files\/\d+/.test(pathname)) return "file";
    if (/\/quizzes\/\d+/.test(pathname)) return "quiz";
    if (/\/courses\/\d+(?:\/)?$/.test(pathname)) return "course_home";
  } catch {
    return "unknown";
  }

  return "unknown";
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "untitled";
}

export function hashSource(source: string): string {
  let hash = 2166136261;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isBlockElement(element: Element): boolean {
  return /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|BR|DD|DETAILS|DIV|DL|DT|FIELDSET|FIGCAPTION|FIGURE|FOOTER|FORM|H1|H2|H3|H4|H5|H6|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TBODY|TD|TFOOT|TH|THEAD|TR|UL)$/i.test(
    element.tagName
  );
}

function appendTextFromNode(node: Node, parts: string[]): void {
  if (node.nodeType === 3) {
    const value = node.textContent?.replace(/\s+/g, " ").trim();

    if (value) {
      parts.push(value);
    }

    return;
  }

  if (node.nodeType !== 1) {
    return;
  }

  const element = node as Element;
  const isListItem = element.tagName.toLowerCase() === "li";

  if (isListItem) {
    parts.push("\n- ");
  } else if (isBlockElement(element)) {
    parts.push("\n");
  }

  element.childNodes.forEach((child) => appendTextFromNode(child, parts));

  if (isBlockElement(element)) {
    parts.push("\n");
  }
}

export function extractReadableText(element: Element | Document): string {
  const root =
    element.nodeType === 9
      ? (element as Document).body || (element as Document).documentElement
      : (element as Element);
  const parts: string[] = [];

  appendTextFromNode(root, parts);

  return normalizeWhitespace(parts.join(" ").replace(/\n\s+/g, "\n"));
}

export function selectMainContent(document: Document): Element {
  return (
    MAIN_CONTENT_SELECTORS.map((selector) => document.querySelector(selector)).find(Boolean) ||
    document.body ||
    document.documentElement
  );
}

export function createDoc(input: {
  id: string;
  courseId: string;
  route: CanvasRoute;
  type: CanvasContextDocType;
  title: string;
  url: string;
  text: string;
  collectedAt: number;
  metadata?: Partial<CanvasContextMetadata>;
}): CanvasContextDoc {
  const text = normalizeWhitespace(input.text);

  return {
    id: input.id,
    courseId: input.courseId,
    route: input.route,
    type: input.type,
    title: normalizeWhitespace(input.title) || "Untitled Canvas document",
    url: input.url,
    text,
    metadata: {
      ...input.metadata,
      collectedAt: input.collectedAt,
      sourceHash: input.metadata?.sourceHash || hashSource(`${input.url}\n${input.title}\n${text}`)
    }
  };
}

export function parseBaseCanvasPage(input: CanvasParseInput): CanvasContextDoc[] {
  const route = input.route || inferRouteFromUrl(input.url);
  const courseId = input.courseId || inferCourseIdFromUrl(input.url);
  const collectedAt = input.collectedAt || Date.now();
  const title =
    getTrimmedText(input.document.querySelector("h1")) ||
    input.title ||
    input.document.title ||
    "Canvas page";
  const mainContent = selectMainContent(input.document);
  const text = extractReadableText(mainContent);

  return [
    createDoc({
      id: `${courseId || "canvas"}:${route}:fallback:${hashSource(input.url)}`,
      courseId,
      route,
      type: "unknown",
      title,
      url: input.url,
      text,
      collectedAt
    })
  ];
}

export function getBaseParsedPage(input: CanvasParseInput): BaseParsedPage {
  const route = input.route || inferRouteFromUrl(input.url);
  const courseId = input.courseId || inferCourseIdFromUrl(input.url);
  const collectedAt = input.collectedAt || Date.now();
  const title =
    getTrimmedText(input.document.querySelector("h1")) ||
    input.title ||
    input.document.title ||
    "Canvas page";
  const mainContent = selectMainContent(input.document);
  const text = extractReadableText(mainContent);

  return {
    courseId,
    route,
    title,
    url: input.url,
    text,
    sourceHash: hashSource(`${input.url}\n${title}\n${text}`),
    collectedAt
  };
}
