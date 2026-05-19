import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { parseCanvasPage } from "../../../canvas/parse";

const FIXTURE_ROOT = join(process.cwd(), "tests", "fixtures", "canvas", "parse");

function loadFixture(name: string): Document {
  const html = readFileSync(join(FIXTURE_ROOT, name), "utf8");
  return new JSDOM(html, { url: "https://canvas.example.edu/courses/42" }).window.document;
}

describe("Canvas parser layer", () => {
  it("extracts assignment fields and visible rubric text", () => {
    const docs = parseCanvasPage({
      document: loadFixture("assignment.html"),
      url: "https://canvas.example.edu/courses/42/assignments/100",
      route: "assignment",
      collectedAt: 1716000000000
    });

    const assignment = docs.find((doc) => doc.type === "assignment");
    const rubric = docs.find((doc) => doc.type === "rubric");

    expect(docs).toHaveLength(2);
    expect(assignment).toMatchObject({
      courseId: "42",
      route: "assignment",
      title: "Research Reflection"
    });
    expect(assignment?.text).toContain("Read the Week 4 sources");
    expect(assignment?.metadata.dueAt).toBe("May 24 at 11:59pm");
    expect(assignment?.metadata.availableFrom).toBe("May 17 at 12am");
    expect(assignment?.metadata.availableUntil).toBe("May 25 at 12am");
    expect(assignment?.metadata.points).toBe("25 pts");
    expect(assignment?.metadata.submissionType).toBe("Online text entry or file upload");
    expect(assignment?.metadata.moduleBreadcrumb).toContain("Week 4 Methods");
    expect(assignment?.metadata.linkedFiles).toEqual([
      {
        title: "Reflection template",
        url: "https://canvas.example.edu/courses/42/files/9001",
        type: "file"
      }
    ]);
    expect(rubric?.text).toContain("Uses course sources clearly");
  });

  it("extracts module titles and visible item links without fetching linked pages", () => {
    const docs = parseCanvasPage({
      document: loadFixture("modules.html"),
      url: "https://canvas.example.edu/courses/42/modules",
      route: "modules",
      collectedAt: 1716000000000
    });

    expect(docs).toHaveLength(2);
    expect(docs[0]).toMatchObject({
      type: "module",
      title: "Week 1: Orientation"
    });
    expect(docs[0].metadata.moduleItems).toEqual([
      expect.objectContaining({
        title: "Start Here",
        url: "https://canvas.example.edu/courses/42/pages/start-here",
        itemType: "Page",
        completionRequirement: "Mark as done"
      }),
      expect.objectContaining({
        title: "Intro Survey",
        url: "https://canvas.example.edu/courses/42/assignments/100",
        itemType: "Assignment"
      })
    ]);
    expect(docs[1].metadata.moduleItems?.[0]).toMatchObject({
      title: "Reading Packet",
      url: "https://canvas.example.edu/courses/42/files/200",
      lockState: "Locked until May 20"
    });
  });

  it("extracts wiki body, linked files, and iframe metadata", () => {
    const [doc] = parseCanvasPage({
      document: loadFixture("page.html"),
      url: "https://canvas.example.edu/courses/42/pages/lab-safety-notes",
      route: "page",
      collectedAt: 1716000000000
    });

    expect(doc.type).toBe("page");
    expect(doc.title).toBe("Lab Safety Notes");
    expect(doc.text).toContain("Review the safety checklist");
    expect(doc.metadata.linkedFiles?.[0]).toMatchObject({
      title: "Safety checklist PDF",
      url: "https://canvas.example.edu/courses/42/files/300"
    });
    expect(doc.metadata.embeddedIframes?.[0]).toMatchObject({
      title: "Lab demo video",
      url: "https://example.edu/embed/lab-demo"
    });
  });

  it("extracts syllabus body and visible course summary rows", () => {
    const [doc] = parseCanvasPage({
      document: loadFixture("syllabus.html"),
      url: "https://canvas.example.edu/courses/42/assignments/syllabus",
      route: "syllabus",
      collectedAt: 1716000000000
    });

    expect(doc.type).toBe("syllabus");
    expect(doc.text).toContain("Course Policies");
    expect(doc.metadata.courseSummaryRows).toContain("May 24 | Research Reflection due");
  });

  it("falls back conservatively for unknown Canvas routes", () => {
    const [doc] = parseCanvasPage({
      document: loadFixture("fallback.html"),
      url: "https://canvas.example.edu/courses/42",
      route: "unknown",
      collectedAt: 1716000000000
    });

    expect(doc.type).toBe("unknown");
    expect(doc.text).toContain("Welcome to this redacted course workspace.");
    expect(doc.text).not.toContain("Canvas header");
    expect(doc.text).not.toContain("Hidden enrollment detail");
    expect(doc.metadata.sourceHash).toBeTruthy();
  });
});
