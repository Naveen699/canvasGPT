import { describe, expect, it } from "vitest";
import { CanvasContextDoc } from "../../../canvas/parse";
import {
  CanvasChunk,
  chunkDocument,
  estimateTokens,
  retrieveCanvasChunks
} from "../../../canvas/retrieval";

function makeDoc(overrides: Partial<CanvasContextDoc>): CanvasContextDoc {
  return {
    id: overrides.id || "42:page:test",
    courseId: overrides.courseId || "42",
    route: overrides.route || "page",
    type: overrides.type || "page",
    title: overrides.title || "Test document",
    url: overrides.url || "https://canvas.example.edu/courses/42/pages/test",
    text: overrides.text || "Test document text",
    metadata: {
      collectedAt: 1716000000000,
      sourceHash: "test-source",
      ...overrides.metadata
    }
  };
}

function repeatedParagraph(index: number): string {
  return `Section ${index}\nResearch methods deadline notes require careful reading and complete submission details for the course project. `.repeat(11);
}

function textWithEstimatedTokens(tokens: number, word = "aaa"): string {
  return `${word} `.repeat(tokens).trim();
}

describe("Canvas retrieval layer", () => {
  it("chunks long documents into bounded token ranges with overlap", () => {
    const paragraphs = Array.from({ length: 28 }, (_, index) => repeatedParagraph(index + 1));
    const doc = makeDoc({
      id: "42:page:long",
      text: paragraphs.join("\n\n")
    });

    const chunks = chunkDocument(doc);

    expect(chunks.length).toBeGreaterThan(1);

    chunks.forEach((chunk, index) => {
      expect(chunk.tokenEstimate).toBeLessThanOrEqual(900);

      if (index < chunks.length - 1) {
        expect(chunk.tokenEstimate).toBeGreaterThanOrEqual(500);
      }
    });

    const sharedText = chunks[0].text.split("\n\n").at(-1);
    expect(sharedText).toBeTruthy();
    expect(chunks[1].text).toContain(sharedText);
  });

  it("drops overlap when overlap plus next block would exceed the max chunk size", () => {
    const doc = makeDoc({
      id: "42:page:overlap-bound",
      text: [
        textWithEstimatedTokens(80, "aaa"),
        textWithEstimatedTokens(850, "bbb"),
        textWithEstimatedTokens(50, "ccc")
      ].join("\n\n")
    });

    const chunks = chunkDocument(doc, {
      minTokens: 500,
      maxTokens: 900,
      overlapTokens: 100
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.tokenEstimate <= 900)).toBe(true);
    expect(chunks[1].text).not.toContain(chunks[0].text);
  });

  it("accumulates small blocks before flushing non-final chunks when possible", () => {
    const doc = makeDoc({
      id: "42:page:min-target",
      text: [
        textWithEstimatedTokens(200, "aaa"),
        textWithEstimatedTokens(500, "bbb"),
        textWithEstimatedTokens(200, "ccc")
      ].join("\n\n")
    });

    const chunks = chunkDocument(doc, {
      minTokens: 300,
      maxTokens: 600,
      overlapTokens: 0
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].tokenEstimate).toBeGreaterThanOrEqual(300);
    expect(chunks[0].tokenEstimate).toBeLessThanOrEqual(600);
    expect(chunks[0].text).toContain("aaa");
    expect(chunks[0].text).toContain("bbb");
  });

  it("keeps assignment metadata attached to every assignment chunk", () => {
    const doc = makeDoc({
      id: "42:assignment:reflection",
      route: "assignment",
      type: "assignment",
      title: "Research Reflection",
      url: "https://canvas.example.edu/courses/42/assignments/100",
      text: Array.from({ length: 26 }, (_, index) => repeatedParagraph(index + 1)).join("\n\n"),
      metadata: {
        collectedAt: 1716000000000,
        sourceHash: "assignment-source",
        dueAt: "May 24 at 11:59pm",
        points: "25 pts",
        submissionType: "Online text entry or file upload",
        moduleBreadcrumb: "Week 4 Methods"
      }
    });

    const chunks = chunkDocument(doc);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.metadata.dueAt === "May 24 at 11:59pm")).toBe(true);
    expect(chunks.every((chunk) => chunk.metadata.submissionType === "Online text entry or file upload")).toBe(true);
  });

  it("does not split table-like rows apart", () => {
    const tableRow = "May 24 | Research Reflection due | 25 pts";
    const doc = makeDoc({
      id: "42:syllabus:test",
      route: "syllabus",
      type: "syllabus",
      text: [
        Array.from({ length: 12 }, (_, index) => repeatedParagraph(index + 1)).join("\n\n"),
        tableRow,
        Array.from({ length: 12 }, (_, index) => repeatedParagraph(index + 20)).join("\n\n")
      ].join("\n\n"),
      metadata: {
        collectedAt: 1716000000000,
        sourceHash: "syllabus-source",
        courseSummaryRows: [tableRow]
      }
    });

    const chunks = chunkDocument(doc);
    const chunkWithRow = chunks.find((chunk) => chunk.text.includes(tableRow));

    expect(chunkWithRow).toBeTruthy();
    expect(chunkWithRow?.text).toContain(tableRow);
    expect(estimateTokens(tableRow)).toBeLessThan(chunkWithRow?.tokenEstimate || 0);
  });

  it("boosts assignment and rubric chunks for submit requirement questions", () => {
    const docs: CanvasContextDoc[] = [
      makeDoc({
        id: "42:page:overview",
        type: "page",
        title: "Course Overview",
        text: "This page has a broad weekly overview and mentions submit once in passing."
      }),
      makeDoc({
        id: "42:assignment:reflection",
        route: "assignment",
        type: "assignment",
        title: "Research Reflection",
        url: "https://canvas.example.edu/courses/42/assignments/100",
        text: "Read the Week 4 sources. Submit a two page reflection and include citations.",
        metadata: {
          collectedAt: 1716000000000,
          sourceHash: "assignment-source",
          submissionType: "Online text entry or file upload"
        }
      }),
      makeDoc({
        id: "42:assignment:reflection:rubric",
        route: "assignment",
        type: "rubric",
        title: "Research Reflection Rubric",
        url: "https://canvas.example.edu/courses/42/assignments/100",
        text: "Rubric requirements: uses course sources clearly and answers every prompt."
      })
    ];

    const result = retrieveCanvasChunks("what do I need to submit?", docs);

    expect(result.chunks.slice(0, 2).map((chunk) => chunk.type)).toEqual(["assignment", "rubric"]);
  });

  it("returns bounded chunks, sources, and estimated token totals", () => {
    const docs = Array.from({ length: 12 }, (_, index) =>
      makeDoc({
        id: `42:assignment:${index}`,
        route: "assignment",
        type: "assignment",
        title: `Deadline Assignment ${index}`,
        url: `https://canvas.example.edu/courses/42/assignments/${index}`,
        text: Array.from({ length: 8 }, (_, paragraphIndex) => repeatedParagraph(paragraphIndex + index + 1)).join("\n\n"),
        metadata: {
          collectedAt: 1716000000000 + index,
          sourceHash: `source-${index}`,
          dueAt: "May 24 at 11:59pm"
        }
      })
    );

    const result = retrieveCanvasChunks("deadline", docs);

    expect(result.chunks.length).toBeLessThanOrEqual(8);
    expect(result.sources.length).toBeLessThanOrEqual(6);
    expect(result.estimatedTokens).toBe(
      result.chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0)
    );
  });

  it("does not return a first chunk that exceeds the input token budget", () => {
    const doc = makeDoc({
      id: "42:assignment:oversized",
      route: "assignment",
      type: "assignment",
      title: "Oversized Deadline Assignment",
      text: "deadline submit rubric"
    });
    const oversizedChunk: CanvasChunk = {
      id: "oversized:chunk",
      courseId: doc.courseId,
      docId: doc.id,
      title: doc.title,
      type: doc.type,
      url: doc.url,
      text: "deadline submit rubric",
      tokenEstimate: 100,
      metadata: doc.metadata,
      chunkIndex: 0
    };

    const result = retrieveCanvasChunks("deadline", [doc], {
      chunks: [oversizedChunk],
      maxInputTokens: 50
    });

    expect(result.chunks).toHaveLength(0);
    expect(result.sources).toHaveLength(0);
    expect(result.estimatedTokens).toBe(0);
  });
});
