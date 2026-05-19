import {
  CanvasContextDoc,
  CanvasParseInput,
  createDoc,
  extractLinkedFiles,
  extractReadableText,
  firstMatchingText,
  getBaseParsedPage,
  getTrimmedText,
  hashSource,
  normalizeWhitespace,
  selectMainContent,
  slugify,
  uniqueBy
} from "./base";

function collectTexts(document: Document, selectors: string[]): string[] {
  return uniqueBy(
    selectors.flatMap((selector) =>
      Array.from(document.querySelectorAll(selector))
        .map(getTrimmedText)
        .filter(Boolean)
    ),
    (text) => text.toLowerCase()
  );
}

function extractLabeledText(pageText: string, labels: string[]): string {
  const escapedLabels = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(?:^|\\n)\\s*(${escapedLabels.join("|")})\\s*:?\\s*([^\\n]+)`, "i");
  const match = pageText.match(pattern);

  return normalizeWhitespace(match?.[2] || "");
}

function extractDefinitionText(document: Document, labels: string[]): string {
  const terms = Array.from(document.querySelectorAll("dt"));
  const match = terms.find((term) =>
    labels.some((label) => getTrimmedText(term).toLowerCase() === label.toLowerCase())
  );
  const value = match?.nextElementSibling;

  return value?.tagName.toLowerCase() === "dd" ? getTrimmedText(value) : "";
}

function extractPoints(pageText: string, document: Document): string {
  const pointText =
    extractDefinitionText(document, ["Points", "Points Possible"]) ||
    firstMatchingText(document, [
      ".points_possible",
      ".assignment-points",
      "[class*='points']",
      "[data-testid*='points']"
    ]) || extractLabeledText(pageText, ["Points", "Points Possible"]);
  const match = pointText.match(/(\d+(?:\.\d+)?\s*(?:pts?|points)?)/i);

  return normalizeWhitespace(match?.[1] || pointText);
}

function extractDateText(pageText: string, labels: string[], document: Document): string {
  const labelText = extractDefinitionText(document, labels) || extractLabeledText(pageText, labels);

  if (labelText) {
    return labelText;
  }

  return collectTexts(document, [
    ".assignment_dates",
    ".due_date",
    "[class*='due']",
    "time[datetime]"
  ]).find((text) => labels.some((label) => text.toLowerCase().includes(label.toLowerCase()))) || "";
}

function extractInstructions(document: Document): string {
  const instructionRoot =
    document.querySelector("#assignment_show .description") ||
    document.querySelector("#assignment_show .user_content") ||
    document.querySelector(".assignment-description") ||
    document.querySelector(".show-content .user_content") ||
    document.querySelector(".user_content");

  return instructionRoot
    ? extractReadableText(instructionRoot)
    : extractReadableText(selectMainContent(document));
}

function extractSubmissionType(pageText: string, document: Document): string {
  const submissionText =
    extractDefinitionText(document, ["Submitting", "Submission Type", "Submission Types", "Online Entry Options"]) ||
    firstMatchingText(document, [
      ".submission_types",
      ".assignment-submission-types",
      "[class*='submission-type']",
      "[data-testid*='submission']"
    ]) || extractLabeledText(pageText, ["Submitting", "Submission Type", "Submission Types", "Online Entry Options"]);

  return normalizeWhitespace(submissionText);
}

function extractModuleBreadcrumb(document: Document): string {
  return firstMatchingText(document, [
    ".module-sequence-footer-content",
    ".module-sequence-padding",
    ".context_module",
    "[class*='module'][class*='breadcrumb']"
  ]);
}

function extractRubricText(document: Document): string {
  const rubricRoot =
    document.querySelector("#rubric_holder") ||
    document.querySelector("#rubric_summary_holder") ||
    document.querySelector(".rubric") ||
    document.querySelector("[id*='rubric']");

  return rubricRoot ? extractReadableText(rubricRoot) : "";
}

export function parseAssignment(input: CanvasParseInput): CanvasContextDoc[] {
  const base = getBaseParsedPage(input);
  const pageText = base.text;
  const title =
    firstMatchingText(input.document, [
      "h1.assignment-title",
      ".assignment-title",
      ".title-content",
      "h1"
    ]) || base.title;
  const instructions = extractInstructions(input.document);
  const dueAt = extractDateText(pageText, ["Due", "Due Date"], input.document);
  const availableFrom = extractDateText(pageText, ["Available from", "Available"], input.document);
  const availableUntil = extractDateText(pageText, ["Until", "Available until"], input.document);
  const points = extractPoints(pageText, input.document);
  const submissionType = extractSubmissionType(pageText, input.document);
  const linkedFiles = extractLinkedFiles(input.document, input.url);
  const moduleBreadcrumb = extractModuleBreadcrumb(input.document);
  const rubricText = extractRubricText(input.document);
  const assignmentText = normalizeWhitespace(
    [
      title,
      instructions,
      dueAt ? `Due: ${dueAt}` : "",
      points ? `Points: ${points}` : "",
      submissionType ? `Submission: ${submissionType}` : "",
      moduleBreadcrumb ? `Module: ${moduleBreadcrumb}` : ""
    ].filter(Boolean).join("\n\n")
  );

  const assignmentDoc = createDoc({
    id: `${base.courseId || "canvas"}:assignment:${slugify(title)}:${hashSource(input.url)}`,
    courseId: base.courseId,
    route: "assignment",
    type: "assignment",
    title,
    url: input.url,
    text: assignmentText,
    collectedAt: base.collectedAt,
    metadata: {
      dueAt,
      availableFrom,
      availableUntil,
      points,
      submissionType,
      moduleBreadcrumb,
      linkedFiles,
      sourceHash: base.sourceHash
    }
  });

  if (!rubricText) {
    return [assignmentDoc];
  }

  return [
    assignmentDoc,
    createDoc({
      id: `${assignmentDoc.id}:rubric`,
      courseId: base.courseId,
      route: "assignment",
      type: "rubric",
      title: `${title} Rubric`,
      url: input.url,
      text: rubricText,
      collectedAt: base.collectedAt,
      metadata: {
        sourceHash: hashSource(`${input.url}\nrubric\n${rubricText}`)
      }
    })
  ];
}
