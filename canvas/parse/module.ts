import {
  CanvasContextDoc,
  CanvasModuleItemMetadata,
  CanvasParseInput,
  absolutizeUrl,
  createDoc,
  extractReadableText,
  getBaseParsedPage,
  getTrimmedText,
  hashSource,
  normalizeWhitespace,
  selectMainContent,
  slugify,
  uniqueBy
} from "./base";

const MODULE_SELECTORS = [
  ".context_module",
  ".context-module",
  ".module",
  "[data-module-id]"
];

function findModuleElements(document: Document): Element[] {
  const modules = MODULE_SELECTORS.flatMap((selector) => Array.from(document.querySelectorAll(selector)));

  return uniqueBy(modules, (element) => {
    const id = element.getAttribute("id") || element.getAttribute("data-module-id");
    return id || getTrimmedText(element).slice(0, 120);
  });
}

function extractModuleTitle(moduleElement: Element, index: number): string {
  return (
    getTrimmedText(moduleElement.querySelector(".ig-header .name")) ||
    getTrimmedText(moduleElement.querySelector(".context_module_name")) ||
    getTrimmedText(moduleElement.querySelector(".module-title")) ||
    getTrimmedText(moduleElement.querySelector("h2, h3, h4")) ||
    `Module ${index + 1}`
  );
}

function inferItemType(link: HTMLAnchorElement, itemElement: Element | null): string {
  const typeLabel =
    getTrimmedText(itemElement?.querySelector(".type_icon, .module_item_icons, [class*='type']")) ||
    itemElement?.getAttribute("data-type") ||
    link.getAttribute("data-item-type") ||
    "";

  if (typeLabel) {
    return normalizeWhitespace(typeLabel);
  }

  const href = link.getAttribute("href") || "";

  if (href.includes("/assignments/")) return "assignment";
  if (href.includes("/pages/")) return "page";
  if (href.includes("/files/")) return "file";
  if (href.includes("/discussion_topics/")) return "discussion";
  if (href.includes("/quizzes/")) return "quiz";

  return "link";
}

function extractItemText(itemElement: Element | null, selectors: string[]): string {
  if (!itemElement) {
    return "";
  }

  return selectors
    .map((selector) => getTrimmedText(itemElement.querySelector(selector)))
    .find(Boolean) || "";
}

function extractModuleItems(moduleElement: Element, baseUrl: string): CanvasModuleItemMetadata[] {
  const links = Array.from(
    moduleElement.querySelectorAll<HTMLAnchorElement>(
      ".ig-title a[href], .module-item-title a[href], a[href*='/courses/']"
    )
  );

  return uniqueBy(
    links
      .map((link) => {
        const itemElement = link.closest(".context_module_item, .module-item, li, .ig-row");
        const title =
          getTrimmedText(link) ||
          getTrimmedText(itemElement?.querySelector(".title, .item_name")) ||
          link.getAttribute("title") ||
          "Untitled module item";

        return {
          title,
          url: absolutizeUrl(link.getAttribute("href"), baseUrl),
          itemType: inferItemType(link, itemElement),
          completionRequirement: extractItemText(itemElement, [
            ".completion_requirement",
            ".requirements_message",
            "[class*='requirement']"
          ]),
          lockState: extractItemText(itemElement, [
            ".locked_title",
            ".lock_explanation",
            "[class*='lock']"
          ])
        };
      })
      .filter((item) => item.title || item.url),
    (item) => `${item.title}:${item.url}`
  );
}

function parseModuleElement(input: CanvasParseInput, moduleElement: Element, index: number): CanvasContextDoc {
  const base = getBaseParsedPage(input);
  const title = extractModuleTitle(moduleElement, index);
  const moduleItems = extractModuleItems(moduleElement, input.url);
  const text = normalizeWhitespace(
    [
      title,
      extractReadableText(moduleElement),
      moduleItems
        .map((item) =>
          [
            item.title,
            item.itemType ? `Type: ${item.itemType}` : "",
            item.url ? `URL: ${item.url}` : "",
            item.completionRequirement ? `Requirement: ${item.completionRequirement}` : "",
            item.lockState ? `Lock: ${item.lockState}` : ""
          ].filter(Boolean).join("\n")
        )
        .join("\n\n")
    ].filter(Boolean).join("\n\n")
  );

  return createDoc({
    id: `${base.courseId || "canvas"}:module:${slugify(title)}:${hashSource(`${input.url}:${index}`)}`,
    courseId: base.courseId,
    route: "modules",
    type: "module",
    title,
    url: input.url,
    text,
    collectedAt: base.collectedAt,
    metadata: {
      moduleItems,
      sourceHash: hashSource(`${input.url}\n${title}\n${text}`)
    }
  });
}

export function parseModules(input: CanvasParseInput): CanvasContextDoc[] {
  const modules = findModuleElements(input.document);

  if (modules.length) {
    return modules.map((moduleElement, index) => parseModuleElement(input, moduleElement, index));
  }

  const base = getBaseParsedPage(input);
  const mainContent = selectMainContent(input.document);
  const moduleItems = extractModuleItems(mainContent, input.url);

  return [
    createDoc({
      id: `${base.courseId || "canvas"}:modules:${hashSource(input.url)}`,
      courseId: base.courseId,
      route: "modules",
      type: "module",
      title: base.title,
      url: input.url,
      text: base.text,
      collectedAt: base.collectedAt,
      metadata: {
        moduleItems,
        sourceHash: base.sourceHash
      }
    })
  ];
}
