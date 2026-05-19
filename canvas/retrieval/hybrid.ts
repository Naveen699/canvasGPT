import { CanvasContextDoc } from "../parse/base";
import {
  CanvasChunk,
  CanvasSourceCitation,
  ChunkOptions,
  chunkDocuments
} from "./chunk";
import { detectQueryIntent, scoreIntentBoost } from "./intent";
import { scoreKeywordMatch } from "./keyword";

export type RetrievalResult = {
  chunks: CanvasChunk[];
  sources: CanvasSourceCitation[];
  estimatedTokens: number;
};

export type RetrievalOptions = ChunkOptions & {
  chunks?: CanvasChunk[];
  currentUrl?: string;
  currentModule?: string;
  maxChunks?: number;
  maxSources?: number;
  maxInputTokens?: number;
};

type ScoredChunk = {
  chunk: CanvasChunk;
  score: number;
};

const DEFAULT_MAX_CHUNKS = 8;
const DEFAULT_MAX_SOURCES = 6;
const DEFAULT_MAX_INPUT_TOKENS = 8000;
const RECENCY_WINDOW_MS = 1000 * 60 * 60 * 24 * 30;

function scoreCurrentPageBoost(chunk: CanvasChunk, options: RetrievalOptions): number {
  let score = 0;

  if (options.currentUrl && chunk.url === options.currentUrl) {
    score += 8;
  }

  if (
    options.currentModule &&
    chunk.metadata.moduleBreadcrumb?.toLowerCase().includes(options.currentModule.toLowerCase())
  ) {
    score += 5;
  }

  return score;
}

function scoreRecencyBoost(chunk: CanvasChunk, newestCollectedAt: number): number {
  const collectedAt = chunk.metadata.collectedAt || 0;

  if (!collectedAt || !newestCollectedAt) {
    return 0;
  }

  const ageRatio = Math.max(0, 1 - (newestCollectedAt - collectedAt) / RECENCY_WINDOW_MS);
  return ageRatio * 3;
}

function toSourceCitation(chunk: CanvasChunk): CanvasSourceCitation {
  return {
    docId: chunk.docId,
    title: chunk.title,
    type: chunk.type,
    url: chunk.url
  };
}

function sourceKey(source: CanvasSourceCitation): string {
  return source.url || source.docId;
}

function selectBoundedChunks(scoredChunks: ScoredChunk[], options: Required<Pick<RetrievalOptions, "maxChunks" | "maxSources" | "maxInputTokens">>): RetrievalResult {
  const selected: CanvasChunk[] = [];
  const sources: CanvasSourceCitation[] = [];
  const sourceKeys = new Set<string>();
  let estimatedTokens = 0;

  for (const { chunk } of scoredChunks) {
    if (selected.length >= options.maxChunks) {
      break;
    }

    const nextTokenTotal = estimatedTokens + chunk.tokenEstimate;

    if (nextTokenTotal > options.maxInputTokens) {
      continue;
    }

    const source = toSourceCitation(chunk);
    const key = sourceKey(source);
    const isNewSource = !sourceKeys.has(key);

    if (isNewSource && sources.length >= options.maxSources) {
      continue;
    }

    selected.push(chunk);
    estimatedTokens = nextTokenTotal;

    if (isNewSource) {
      sourceKeys.add(key);
      sources.push(source);
    }
  }

  return {
    chunks: selected,
    sources,
    estimatedTokens
  };
}

export function retrieveCanvasChunks(query: string, docs: CanvasContextDoc[], options: RetrievalOptions = {}): RetrievalResult {
  const chunks = options.chunks || chunkDocuments(docs, options);
  const intent = detectQueryIntent(query);
  const newestCollectedAt = chunks.reduce(
    (newest, chunk) => Math.max(newest, chunk.metadata.collectedAt || 0),
    0
  );
  const scoredChunks = chunks
    .map((chunk) => ({
      chunk,
      score:
        scoreKeywordMatch(query, chunk).score +
        scoreIntentBoost(intent, chunk) +
        scoreCurrentPageBoost(chunk, options) +
        scoreRecencyBoost(chunk, newestCollectedAt)
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      const rightIsCurrentUrl = Boolean(options.currentUrl && right.chunk.url === options.currentUrl);
      const leftIsCurrentUrl = Boolean(options.currentUrl && left.chunk.url === options.currentUrl);

      if (rightIsCurrentUrl !== leftIsCurrentUrl) {
        return rightIsCurrentUrl ? 1 : -1;
      }

      return (right.chunk.metadata.collectedAt || 0) - (left.chunk.metadata.collectedAt || 0);
    });

  return selectBoundedChunks(scoredChunks, {
    maxChunks: options.maxChunks ?? DEFAULT_MAX_CHUNKS,
    maxSources: options.maxSources ?? DEFAULT_MAX_SOURCES,
    maxInputTokens: options.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS
  });
}
