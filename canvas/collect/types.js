(function initCanvasCollectTypes(globalScope) {
  const ACTIVE_PAGE_CONTEXT_MESSAGE = "COLLECT_ACTIVE_PAGE_CONTEXT";
  const RAW_HTML_LIFECYCLE_TRANSIENT = "transient";

  function isRawCanvasPage(value) {
    return Boolean(
      value &&
        typeof value.url === "string" &&
        typeof value.title === "string" &&
        typeof value.html === "string" &&
        typeof value.text === "string" &&
        typeof value.contentType === "string"
    );
  }

  globalScope.CanvasCollectTypes = {
    ACTIVE_PAGE_CONTEXT_MESSAGE,
    RAW_HTML_LIFECYCLE_TRANSIENT,
    isRawCanvasPage
  };
})(globalThis);
