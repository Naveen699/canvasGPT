(function initCanvasCollectionStatus(globalScope) {
  const STATES = {
    idle: "idle",
    collecting: "collecting",
    parsing: "parsing",
    ready: "ready",
    error: "error"
  };

  const STATUS_MESSAGES = {
    [STATES.idle]: "Ready to collect the current Canvas page.",
    [STATES.collecting]: "Collecting the active Canvas page...",
    [STATES.parsing]: "Parsing current page context...",
    [STATES.ready]: "Current Canvas page collected.",
    [STATES.error]: "Could not collect the current Canvas page."
  };

  function createStatus(state, detail = {}) {
    return {
      state,
      message: detail.message || STATUS_MESSAGES[state] || "Canvas collection status changed.",
      updatedAt: new Date().toISOString()
    };
  }

  globalScope.CanvasCollectionStatus = {
    STATES,
    createStatus
  };
})(globalThis);
