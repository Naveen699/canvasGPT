(function materialKeysFactory(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.CanvasMaterialKeys = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function createMaterialKeys() {
  function getOwnValue(item, names) {
    if (!item || typeof item !== "object") {
      return "";
    }

    for (const name of names) {
      const value = item[name];

      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return String(value).trim();
      }
    }

    return "";
  }

  function normalizeType(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");
  }

  function isObject(value) {
    return Boolean(value && typeof value === "object");
  }

  function isPrimitiveIdentifier(value) {
    return ["string", "number", "bigint"].includes(typeof value);
  }

  function extractIdFromPath(value, patterns) {
    if (!value) {
      return "";
    }

    let path = String(value);

    try {
      path = new URL(path, "https://canvas.invalid").pathname;
    } catch {
      // Treat non-URL values as path-like strings.
    }

    for (const pattern of patterns) {
      const match = path.match(pattern);

      if (match?.[1]) {
        return decodeURIComponent(match[1]);
      }
    }

    return "";
  }

  function getPathFromUrl(value) {
    if (!value) {
      return "";
    }

    try {
      return new URL(String(value), "https://canvas.invalid").pathname;
    } catch {
      return String(value);
    }
  }

  function key(prefix, id) {
    const value = String(id ?? "").trim();
    return value ? `${prefix}:${value}` : null;
  }

  function getFileId(item) {
    if (isPrimitiveIdentifier(item)) {
      return String(item).trim();
    }

    return (
      getOwnValue(item, ["file_id", "fileId", "id", "content_id", "contentId"]) ||
      extractIdFromPath(getOwnValue(item, ["url", "htmlUrl", "html_url", "href"]), [
        /\/files\/([^/?#]+)/i
      ])
    );
  }

  function getPageId(item) {
    if (isPrimitiveIdentifier(item)) {
      return String(item).trim();
    }

    return (
      getOwnValue(item, ["page_url", "pageUrl", "url", "page_id", "pageId", "id"]) ||
      extractIdFromPath(getOwnValue(item, ["htmlUrl", "html_url", "href"]), [
        /\/pages\/([^/?#]+)/i
      ])
    );
  }

  function getAssignmentId(item) {
    if (isPrimitiveIdentifier(item)) {
      return String(item).trim();
    }

    return (
      getOwnValue(item, ["assignment_id", "assignmentId", "id", "content_id", "contentId"]) ||
      extractIdFromPath(getOwnValue(item, ["url", "htmlUrl", "html_url", "href"]), [
        /\/assignments\/([^/?#]+)/i
      ])
    );
  }

  function getAnnouncementId(item) {
    if (isPrimitiveIdentifier(item)) {
      return String(item).trim();
    }

    return (
      getOwnValue(item, ["announcement_id", "announcementId", "id", "discussion_topic_id"]) ||
      extractIdFromPath(getOwnValue(item, ["url", "htmlUrl", "html_url", "href"]), [
        /\/announcements\/([^/?#]+)/i,
        /\/discussion_topics\/([^/?#]+)/i
      ])
    );
  }

  function isDiscussionReply(item) {
    if (!isObject(item)) {
      return false;
    }

    const itemType = normalizeType(item.type || item.itemType || item.kind);
    const hasReplyMarker = [
      "entry_id",
      "entryId",
      "discussion_entry_id",
      "discussionEntryId",
      "discussion_subentry_id",
      "discussionSubentryId",
      "parent_id",
      "parentId"
    ].some((name) => item[name] !== undefined && item[name] !== null && String(item[name]) !== "");

    return hasReplyMarker || itemType === "reply" || itemType === "entry";
  }

  function getDiscussionTopicId(item) {
    if (isPrimitiveIdentifier(item)) {
      return String(item).trim();
    }

    if (isDiscussionReply(item)) {
      return "";
    }

    return (
      getOwnValue(item, ["discussion_topic_id", "discussionTopicId", "topic_id", "topicId", "id"]) ||
      extractIdFromPath(getOwnValue(item, ["url", "htmlUrl", "html_url", "href"]), [
        /\/discussion_topics\/([^/?#]+)/i
      ])
    );
  }

  function getModuleItemId(item) {
    if (isPrimitiveIdentifier(item)) {
      return String(item).trim();
    }

    return getOwnValue(item, ["module_item_id", "moduleItemId", "id"]);
  }

  function getFileMaterialKey(item) {
    return key("file", getFileId(item));
  }

  function getPageMaterialKey(item) {
    return key("page", getPageId(item));
  }

  function getAssignmentMaterialKey(item) {
    return key("assignment", getAssignmentId(item));
  }

  function getAnnouncementMaterialKey(item) {
    return key("announcement", getAnnouncementId(item));
  }

  function getDiscussionMaterialKey(item) {
    return key("discussion", getDiscussionTopicId(item));
  }

  function getModuleItemMaterialKey(item) {
    return key("module_item", getModuleItemId(item));
  }

  function getCanvasUrlMaterialKey(normalizedCanvasUrl) {
    return key("canvas_url", normalizedCanvasUrl);
  }

  function getCanvasUrlReferencedMaterialKey(normalizedCanvasUrl) {
    const pathname = getPathFromUrl(normalizedCanvasUrl);
    const fileId = extractIdFromPath(pathname, [
      /\/files\/([^/?#]+)(?:\/download)?$/i,
      /\/api\/v1\/courses\/[^/?#]+\/files\/([^/?#]+)$/i,
      /\/api\/v1\/files\/([^/?#]+)$/i
    ]);

    if (fileId) {
      return key("file", fileId);
    }

    const assignmentId = extractIdFromPath(pathname, [
      /\/assignments\/([^/?#]+)$/i,
      /\/api\/v1\/courses\/[^/?#]+\/assignments\/([^/?#]+)$/i
    ]);

    if (assignmentId) {
      return key("assignment", assignmentId);
    }

    const pageId = extractIdFromPath(pathname, [
      /\/pages\/([^/?#]+)$/i,
      /\/api\/v1\/courses\/[^/?#]+\/pages\/([^/?#]+)$/i
    ]);

    if (pageId) {
      return key("page", pageId);
    }

    const discussionTopicId = extractIdFromPath(pathname, [
      /\/discussion_topics\/([^/?#]+)$/i,
      /\/api\/v1\/courses\/[^/?#]+\/discussion_topics\/([^/?#]+)$/i
    ]);

    if (discussionTopicId) {
      return key("discussion", discussionTopicId);
    }

    const announcementId = extractIdFromPath(pathname, [
      /\/announcements\/([^/?#]+)$/i,
      /\/api\/v1\/announcements\/([^/?#]+)$/i
    ]);

    if (announcementId) {
      return key("announcement", announcementId);
    }

    return null;
  }

  function getModuleReferencedMaterialKey(item) {
    const type = normalizeType(item?.itemType || item?.type);

    if (type === "file") {
      return getFileMaterialKey(getOwnValue(item, ["content_id", "contentId"]) || item);
    }

    if (type === "assignment") {
      return getAssignmentMaterialKey(getOwnValue(item, ["content_id", "contentId"]) || item);
    }

    if (type === "discussion" || type === "discussiontopic") {
      return getDiscussionMaterialKey(getOwnValue(item, ["content_id", "contentId"]) || item);
    }

    if (type === "page" || type === "wikipage") {
      return getPageMaterialKey(getOwnValue(item, ["page_url", "pageUrl", "content_id", "contentId"]) || item);
    }

    return null;
  }

  function getMaterialKey(item) {
    if (!isObject(item)) {
      return null;
    }

    const type = normalizeType(item.type || item.itemType || item.kind);

    if (type === "file") {
      return getFileMaterialKey(item);
    }

    if (type === "page" || type === "wikipage") {
      return getPageMaterialKey(item);
    }

    if (type === "assignment") {
      return getAssignmentMaterialKey(item);
    }

    if (type === "announcement") {
      return getAnnouncementMaterialKey(item);
    }

    if (type === "discussion" || type === "discussiontopic") {
      return getDiscussionMaterialKey(item);
    }

    if (type === "moduleitem") {
      return getModuleReferencedMaterialKey(item) || getModuleItemMaterialKey(item);
    }

    if (item.normalizedCanvasUrl) {
      return (
        getCanvasUrlReferencedMaterialKey(item.normalizedCanvasUrl) ||
        getCanvasUrlMaterialKey(item.normalizedCanvasUrl)
      );
    }

    return null;
  }

  return {
    getAnnouncementMaterialKey,
    getAssignmentMaterialKey,
    getCanvasUrlMaterialKey,
    getCanvasUrlReferencedMaterialKey,
    getDiscussionMaterialKey,
    getFileMaterialKey,
    getMaterialKey,
    getModuleItemMaterialKey,
    getPageMaterialKey
  };
});
