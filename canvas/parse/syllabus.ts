import {
  CanvasContextDoc,
  CanvasParseInput,
  createDoc,
  extractReadableText,
  getBaseParsedPage,
  getTrimmedText,
  hashSource,
  normalizeWhitespace,
  selectMainContent,
  uniqueBy
} from "./base";

function extractCourseSummaryRows(document: Document): string[] {
  const rows = Array.from(
    document.querySelectorAll("#syllabus tr, .course-summary tr, table.summary tr")
  )
    .map((row) =>
      normalizeWhitespace(
        Array.from(row.querySelectorAll("th, td"))
          .map(getTrimmedText)
          .filter(Boolean)
          .join(" | ")
      )
    )
    .filter(Boolean);

  return uniqueBy(rows, (row) => row.toLowerCase());
}

function extractSyllabusBody(document: Document): string {
  const root =
    document.querySelector("#syllabus .user_content") ||
    document.querySelector("#course_syllabus .user_content") ||
    document.querySelector("#course_syllabus") ||
    document.querySelector(".syllabus") ||
    selectMainContent(document);

  return extractReadableText(root);
}

export function parseSyllabus(input: CanvasParseInput): CanvasContextDoc[] {
  const base = getBaseParsedPage(input);
  const title =
    getTrimmedText(input.document.querySelector("#course_syllabus h1, .syllabus-title, h1")) ||
    base.title ||
    "Syllabus";
  const bodyText = extractSyllabusBody(input.document);
  const courseSummaryRows = extractCourseSummaryRows(input.document);
  const text = normalizeWhitespace(
    [
      bodyText,
      courseSummaryRows.length ? `Course summary\n${courseSummaryRows.join("\n")}` : ""
    ].filter(Boolean).join("\n\n")
  );

  return [
    createDoc({
      id: `${base.courseId || "canvas"}:syllabus:${hashSource(input.url)}`,
      courseId: base.courseId,
      route: "syllabus",
      type: "syllabus",
      title,
      url: input.url,
      text,
      collectedAt: base.collectedAt,
      metadata: {
        courseSummaryRows,
        sourceHash: hashSource(`${input.url}\n${title}\n${text}`)
      }
    })
  ];
}
