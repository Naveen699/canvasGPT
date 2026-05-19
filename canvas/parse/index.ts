import {
  CanvasContextDoc,
  CanvasParseInput,
  CanvasRoute,
  inferRouteFromUrl,
  parseBaseCanvasPage
} from "./base";
import { parseAssignment } from "./assignment";
import { parseModules } from "./module";
import { parsePage } from "./page";
import { sanitizeCanvasInput } from "./sanitize";
import { parseSyllabus } from "./syllabus";

export type {
  CanvasContextDoc,
  CanvasContextDocType,
  CanvasContextMetadata,
  CanvasLinkMetadata,
  CanvasModuleItemMetadata,
  CanvasParseInput,
  CanvasRoute
} from "./base";

export {
  extractReadableText,
  getTrimmedText,
  inferCourseIdFromUrl,
  inferRouteFromUrl,
  normalizeWhitespace,
  parseBaseCanvasPage
} from "./base";
export { sanitizeCanvasDocument } from "./sanitize";
export { parseAssignment } from "./assignment";
export { parseModules } from "./module";
export { parsePage } from "./page";
export { parseSyllabus } from "./syllabus";

function resolveRoute(input: CanvasParseInput): CanvasRoute {
  return input.route || inferRouteFromUrl(input.url);
}

export function parseCanvasPage(input: CanvasParseInput): CanvasContextDoc[] {
  const sanitizedInput = sanitizeCanvasInput({
    ...input,
    route: resolveRoute(input)
  });

  switch (sanitizedInput.route) {
    case "assignment":
      return parseAssignment(sanitizedInput);
    case "modules":
      return parseModules(sanitizedInput);
    case "page":
      return parsePage(sanitizedInput);
    case "syllabus":
      return parseSyllabus(sanitizedInput);
    default:
      return parseBaseCanvasPage(sanitizedInput);
  }
}
