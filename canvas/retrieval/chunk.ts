import {
  CanvasContextDoc,
  CanvasContextDocType,
  CanvasContextMetadata,
  hashSource,
  normalizeWhitespace
} from "../parse/base";

export type CanvasChunk = {
  id: string;
  courseId: string;
  docId: string;
  title: string;
  type: CanvasContextDocType;
  url: string;
  text: string;
  tokenEstimate: number;
  metadata: CanvasContextMetadata;
  chunkIndex: number;
  headingPath?: string[];
};

export type CanvasSourceCitation = {
  docId: string;
  title: string;
  type: CanvasContextDocType;
  url: string;
};

export type ChunkOptions = {
  /**
   * Soft lower bound for non-final chunks. When a splittable block can be
   * divided without exceeding maxTokens, chunking will avoid flushing below it.
   */
  minTokens?: number;
  maxTokens?: number;
  overlapTokens?: number;
};

const DEFAULT_MIN_TOKENS = 500;
const DEFAULT_MAX_TOKENS = 900;
const DEFAULT_OVERLAP_TOKENS = 100;

type TextBlock = {
  text: string;
  tokenEstimate: number;
  headingPath?: string[];
  canSplit?: boolean;
};

function createTextBlock(text: string, headingPath?: string[], canSplit = false): TextBlock {
  return {
    text,
    tokenEstimate: estimateTokens(text),
    headingPath: headingPath?.length ? [...headingPath] : undefined,
    canSplit
  };
}

function resolveChunkOptions(options: ChunkOptions = {}): Required<ChunkOptions> {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    minTokens: Math.min(options.minTokens ?? DEFAULT_MIN_TOKENS, maxTokens),
    maxTokens,
    overlapTokens: options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS
  };
}

export function estimateTokens(text = ""): number {
  const normalized = normalizeWhitespace(text);

  if (!normalized) {
    return 0;
  }

  return Math.max(1, Math.ceil(normalized.length / 4));
}

function isTableLikeLine(line: string): boolean {
  return /\s\|\s/.test(line) || /^\s*\|.*\|\s*$/.test(line);
}

function isHeadingLikeLine(line: string): boolean {
  const trimmed = line.trim();

  if (!trimmed || trimmed.length > 100 || /[.!?]$/.test(trimmed)) {
    return false;
  }

  if (/^#{1,6}\s+/.test(trimmed)) {
    return true;
  }

  return /^[A-Z0-9][A-Za-z0-9:,\-/&'() ]+$/.test(trimmed) && trimmed.split(/\s+/).length <= 12;
}

function splitByWords(text: string, maxTokens: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const parts: string[] = [];
  let current: string[] = [];

  for (const word of words) {
    const candidate = [...current, word].join(" ");

    if (current.length && estimateTokens(candidate) > maxTokens) {
      parts.push(current.join(" "));
      current = [word];
    } else {
      current.push(word);
    }
  }

  if (current.length) {
    parts.push(current.join(" "));
  }

  return parts;
}

function splitLargeText(text: string, maxTokens: number): string[] {
  if (estimateTokens(text) <= maxTokens) {
    return [text];
  }

  const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) || [];
  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const candidate = normalizeWhitespace([current, sentence].filter(Boolean).join(" "));

    if (current && estimateTokens(candidate) > maxTokens) {
      parts.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts.flatMap((part) => splitByWords(part, maxTokens));
}

function textToBlocks(text: string, maxTokens: number): TextBlock[] {
  const lines = normalizeWhitespace(text).split("\n");
  const blocks: TextBlock[] = [];
  const headingPath: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const paragraphText = normalizeWhitespace(paragraph.join(" "));
    paragraph = [];

    if (!paragraphText) {
      return;
    }

    splitLargeText(paragraphText, maxTokens).forEach((part) => {
      blocks.push(createTextBlock(part, headingPath, true));
    });
  };

  for (const rawLine of lines) {
    const line = normalizeWhitespace(rawLine);

    if (!line) {
      flushParagraph();
      continue;
    }

    if (isTableLikeLine(line)) {
      flushParagraph();
      blocks.push(createTextBlock(line, headingPath));
      continue;
    }

    if (isHeadingLikeLine(line)) {
      flushParagraph();
      headingPath.splice(0, headingPath.length, line.replace(/^#{1,6}\s+/, ""));
      blocks.push(createTextBlock(line, headingPath));
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

function takeOverlapBlocks(blocks: TextBlock[], overlapTokens: number): TextBlock[] {
  const overlap: TextBlock[] = [];
  let total = 0;

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];

    if (!overlap.length && block.tokenEstimate > overlapTokens) {
      break;
    }

    if (overlap.length && total + block.tokenEstimate > overlapTokens) {
      break;
    }

    overlap.unshift(block);
    total += block.tokenEstimate;
  }

  return overlap;
}

function splitTextBlock(block: TextBlock, maxTokens: number): TextBlock[] {
  if (!block.canSplit || block.tokenEstimate <= maxTokens) {
    return [block];
  }

  return splitLargeText(block.text, maxTokens).map((part) => createTextBlock(part, block.headingPath, true));
}

function createChunk(doc: CanvasContextDoc, blocks: TextBlock[], chunkIndex: number): CanvasChunk {
  const text = normalizeWhitespace(blocks.map((block) => block.text).join("\n\n"));
  const headingPath = blocks.find((block) => block.headingPath?.length)?.headingPath;

  return {
    id: `${doc.id}:chunk:${chunkIndex}:${hashSource(text)}`,
    courseId: doc.courseId,
    docId: doc.id,
    title: doc.title,
    type: doc.type,
    url: doc.url,
    text,
    tokenEstimate: estimateTokens(text),
    metadata: { ...doc.metadata },
    chunkIndex,
    headingPath
  };
}

export function chunkDocument(doc: CanvasContextDoc, options: ChunkOptions = {}): CanvasChunk[] {
  const resolved = resolveChunkOptions(options);
  const text = normalizeWhitespace(doc.text);

  if (!text) {
    return [];
  }

  const textTokens = estimateTokens(text);

  if (textTokens <= resolved.maxTokens) {
    return [createChunk(doc, [{ text, tokenEstimate: textTokens }], 0)];
  }

  const chunks: CanvasChunk[] = [];
  const blocks = textToBlocks(text, resolved.maxTokens);
  let current: TextBlock[] = [];
  let currentTokens = 0;
  let blockIndex = 0;

  const flushCurrent = () => {
    if (!current.length) {
      return;
    }

    chunks.push(createChunk(doc, current, chunks.length));
    current = takeOverlapBlocks(current, resolved.overlapTokens);
    currentTokens = current.reduce((sum, block) => sum + block.tokenEstimate, 0);
  };

  while (blockIndex < blocks.length) {
    const block = blocks[blockIndex];
    let wouldExceedMax = currentTokens > 0 && currentTokens + block.tokenEstimate > resolved.maxTokens;

    if (wouldExceedMax && currentTokens < resolved.minTokens) {
      const remainingTokens = resolved.maxTokens - currentTokens;
      const splitBlocks = splitTextBlock(block, remainingTokens);

      if (splitBlocks.length > 1) {
        current.push(splitBlocks[0]);
        currentTokens += splitBlocks[0].tokenEstimate;
        blocks.splice(blockIndex, 1, ...splitBlocks.slice(1));
        flushCurrent();
        continue;
      }
    }

    if (wouldExceedMax && current.length) {
      flushCurrent();
    }

    wouldExceedMax = currentTokens > 0 && currentTokens + block.tokenEstimate > resolved.maxTokens;

    if (wouldExceedMax && current.length) {
      current = [];
      currentTokens = 0;
    }

    current.push(block);
    currentTokens += block.tokenEstimate;
    blockIndex += 1;
  }

  if (current.length) {
    chunks.push(createChunk(doc, current, chunks.length));
  }

  return chunks;
}

export function chunkDocuments(docs: CanvasContextDoc[], options: ChunkOptions = {}): CanvasChunk[] {
  return docs.flatMap((doc) => chunkDocument(doc, options));
}
