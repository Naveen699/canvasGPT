import { CanvasContextDocType } from "../parse/base";
import { CanvasChunk } from "./chunk";
import { tokenizeQuery } from "./keyword";

export type QueryIntent = "due" | "submit" | "reading" | "policy";

export type QueryIntentMatch = {
  intents: QueryIntent[];
  boostTypes: Partial<Record<CanvasContextDocType, number>>;
};

const INTENT_KEYWORDS: Record<QueryIntent, string[]> = {
  due: ["due", "deadline", "when", "date", "available", "until"],
  submit: ["submit", "submission", "submitting", "requirements", "requirement", "rubric", "need", "upload", "turn", "deliverable"],
  reading: ["reading", "lecture", "module", "slides", "file", "notes", "page"],
  policy: ["policy", "late", "attendance", "extension", "absence", "grading"]
};

const INTENT_TYPE_BOOSTS: Record<QueryIntent, Partial<Record<CanvasContextDocType, number>>> = {
  due: {
    assignment: 14,
    syllabus: 8,
    module: 6
  },
  submit: {
    assignment: 16,
    rubric: 14
  },
  reading: {
    module: 10,
    page: 8,
    file: 8
  },
  policy: {
    syllabus: 12,
    page: 7
  }
};

const INTENT_EVIDENCE_PATTERNS: Partial<Record<QueryIntent, RegExp>> = {
  due: /\b(due|deadline|available|until)\b/,
  submit: /\b(submit|submission|rubric|requirement|upload|turn in)\b/
};

export function detectQueryIntent(query: string): QueryIntentMatch {
  const terms = new Set(tokenizeQuery(query));
  const intents = (Object.keys(INTENT_KEYWORDS) as QueryIntent[]).filter((intent) =>
    INTENT_KEYWORDS[intent].some((keyword) => terms.has(keyword))
  );
  const boostTypes: Partial<Record<CanvasContextDocType, number>> = {};

  for (const intent of intents) {
    for (const [type, boost] of Object.entries(INTENT_TYPE_BOOSTS[intent]) as Array<[CanvasContextDocType, number]>) {
      boostTypes[type] = (boostTypes[type] || 0) + boost;
    }
  }

  return { intents, boostTypes };
}

export function scoreIntentBoost(intent: QueryIntentMatch, chunk: CanvasChunk): number {
  let score = intent.boostTypes[chunk.type] || 0;
  const text = `${chunk.title}\n${chunk.text}\n${chunk.metadata.submissionType || ""}`.toLowerCase();

  if (intent.intents.includes("submit") && INTENT_EVIDENCE_PATTERNS.submit?.test(text)) {
    score += 8;
  }

  if (intent.intents.includes("due") && INTENT_EVIDENCE_PATTERNS.due?.test(text)) {
    score += 6;
  }

  return score;
}
