export const CANVAS_COLLECTION_STATES = {
  idle: "idle",
  collecting: "collecting",
  parsing: "parsing",
  ready: "ready",
  error: "error"
} as const;

type CanvasCollectionState = keyof typeof CANVAS_COLLECTION_STATES;

const STATUS_MESSAGES: Record<CanvasCollectionState, string> = {
  idle: "Ready to collect the current Canvas page.",
  collecting: "Collecting the active Canvas page...",
  parsing: "Parsing current page context...",
  ready: "Current Canvas page collected.",
  error: "Could not collect the current Canvas page."
};

export function createCollectionStatus(
  state: CanvasCollectionState,
  detail: { message?: string } = {}
) {
  return {
    state,
    message: detail.message || STATUS_MESSAGES[state] || "Canvas collection status changed.",
    updatedAt: new Date().toISOString()
  };
}
