import { CanvasContextMetadata, normalizeWhitespace } from "../parse/base";
import { CanvasChunk } from "./chunk";

export type KeywordScoreBreakdown = {
  score: number;
  exactPhraseMatches: number;
  titleMatches: number;
  metadataMatches: number;
  textMatches: number;
};

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "do",
  "for",
  "how",
  "i",
  "is",
  "it",
  "of",
  "on",
  "the",
  "to",
  "what",
  "when",
  "where",
  "with"
]);

function normalizeForSearch(text = ""): string {
  return normalizeWhitespace(text).toLowerCase();
}

export function tokenizeQuery(query: string): string[] {
  const tokens = normalizeForSearch(query).match(/[a-z0-9']+/g) || [];

  return tokens.filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function countOccurrences(text: string, term: string): number {
  if (!term) {
    return 0;
  }

  const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  return text.match(pattern)?.length || 0;
}

function metadataToText(metadata: CanvasContextMetadata): string {
  return normalizeWhitespace(
    [
      metadata.dueAt ? `Due ${metadata.dueAt}` : "",
      metadata.availableFrom ? `Available from ${metadata.availableFrom}` : "",
      metadata.availableUntil ? `Available until ${metadata.availableUntil}` : "",
      metadata.points ? `Points ${metadata.points}` : "",
      metadata.submissionType ? `Submission ${metadata.submissionType}` : "",
      metadata.moduleBreadcrumb ? `Module ${metadata.moduleBreadcrumb}` : "",
      metadata.linkedFiles?.map((file) => `${file.title} ${file.type || ""} ${file.text || ""}`).join("\n"),
      metadata.embeddedIframes?.map((iframe) => `${iframe.title} ${iframe.type || ""} ${iframe.text || ""}`).join("\n"),
      metadata.moduleItems
        ?.map((item) =>
          [
            item.title,
            item.itemType,
            item.completionRequirement,
            item.lockState,
            item.text
          ].filter(Boolean).join(" ")
        )
        .join("\n"),
      metadata.courseSummaryRows?.join("\n")
    ].filter(Boolean).join("\n")
  );
}

export function buildSearchableChunkText(chunk: CanvasChunk): string {
  return normalizeWhitespace(
    [
      chunk.title,
      chunk.type,
      chunk.url,
      chunk.headingPath?.join(" "),
      metadataToText(chunk.metadata),
      chunk.text
    ].filter(Boolean).join("\n")
  );
}

export function scoreKeywordMatch(query: string, chunk: CanvasChunk): KeywordScoreBreakdown {
  const normalizedQuery = normalizeForSearch(query);
  const queryTerms = tokenizeQuery(query);
  const title = normalizeForSearch(chunk.title);
  const metadata = normalizeForSearch(metadataToText(chunk.metadata));
  const searchableText = normalizeForSearch(buildSearchableChunkText(chunk));
  let exactPhraseMatches = 0;
  let titleMatches = 0;
  let metadataMatches = 0;
  let textMatches = 0;

  if (normalizedQuery.length > 3 && searchableText.includes(normalizedQuery)) {
    exactPhraseMatches = 1;
  }

  for (const term of queryTerms) {
    titleMatches += countOccurrences(title, term);
    metadataMatches += countOccurrences(metadata, term);
    textMatches += Math.min(countOccurrences(searchableText, term), 8);
  }

  return {
    score:
      exactPhraseMatches * 20 +
      titleMatches * 5 +
      metadataMatches * 4 +
      textMatches,
    exactPhraseMatches,
    titleMatches,
    metadataMatches,
    textMatches
  };
}
