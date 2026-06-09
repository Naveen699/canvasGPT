(function initCanvasManifestBuilder(globalScope) {
  const EMPTY_HELPERS = Object.freeze({});

  function compactString(value) {
    return value === undefined || value === null ? "" : String(value).trim();
  }

  function firstPresent(...values) {
    return values.find((value) => compactString(value));
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function getCanvasOrigin(collection, options) {
    const canvasOrigin = compactString(
      options.canvasOrigin ||
        collection.canvasOrigin ||
        collection.canvasBaseUrl ||
        globalScope.location?.origin
    );
    const urlHelpers = getHelper(options, ["urlHelpers", "url"], "CanvasManifestUrl");
    const normalizedOrigin = callFirst(
      urlHelpers,
      ["normalizeCanvasOrigin", "normalizeOrigin"],
      canvasOrigin
    );

    return compactString(normalizedOrigin || canvasOrigin);
  }

  function getHelper(options, optionKeys, globalKey) {
    const injected = optionKeys.map((key) => options[key]).find(Boolean);

    return injected || globalScope[globalKey] || EMPTY_HELPERS;
  }

  function callFirst(helper, methodNames, ...args) {
    for (const methodName of methodNames) {
      if (typeof helper[methodName] === "function") {
        return helper[methodName](...args);
      }
    }

    return undefined;
  }

  function normalizeCanvasUrl(url, canvasOrigin, urlHelpers) {
    if (!compactString(url) || !compactString(canvasOrigin)) {
      return "";
    }

    const helperResult = callFirst(
      urlHelpers,
      [
        "normalizeCanvasUrl",
        "normalizeCanvasURL",
        "normalizeUrl",
        "normalizeURL",
        "normalizeHref",
        "normalize"
      ],
      url,
      canvasOrigin
    );

    if (typeof helperResult === "string") {
      return helperResult;
    }

    if (helperResult && typeof helperResult === "object") {
      if (helperResult.isCurrentOrigin === false || helperResult.isCanvasOrigin === false) {
        return "";
      }

      return compactString(
        helperResult.normalizedUrl ||
          helperResult.normalizedURL ||
          helperResult.normalized ||
          helperResult.url ||
          helperResult.href
      );
    }

    try {
      const parsed = new URL(url, canvasOrigin);
      const origin = new URL(canvasOrigin).origin;

      if (parsed.origin !== origin) {
        return "";
      }

      parsed.hash = "";

      return parsed.toString().replace(/\/$/, "");
    } catch {
      return "";
    }
  }

  function materialKey(kind, value, keyHelpers) {
    const normalizedValue = compactString(value);

    if (!normalizedValue) {
      return "";
    }

    const specificMethods = {
      announcement: ["getAnnouncementMaterialKey"],
      assignment: ["getAssignmentMaterialKey"],
      canvas_url: ["getCanvasUrlMaterialKey"],
      discussion: ["getDiscussionMaterialKey"],
      file: ["getFileMaterialKey"],
      module_item: ["getModuleItemMaterialKey"],
      page: ["getPageMaterialKey"]
    };
    const helperResult =
      callFirst(keyHelpers, specificMethods[kind] || [], normalizedValue) ||
      callFirst(
        keyHelpers,
        [
          "buildMaterialKey",
          "createMaterialKey",
          "materialKey",
          `${kind}Key`,
          `create${kind.charAt(0).toUpperCase()}${kind.slice(1)}Key`
        ],
        kind,
        normalizedValue
      );

    return compactString(helperResult || `${kind}:${normalizedValue}`);
  }

  function materialKeyFromItem(kind, item, fallbackValue, keyHelpers) {
    const helperResult = callFirst(
      keyHelpers,
      ["getMaterialKey"],
      {
        ...item,
        kind,
        type: kind,
        normalizedCanvasUrl: kind === "canvas_url" ? fallbackValue : ""
      }
    );

    return compactString(helperResult) || materialKey(kind, fallbackValue, keyHelpers);
  }

  function materialFromReferencedKey(materialKeyValue, item, canvasUrl) {
    const [kind] = compactString(materialKeyValue).split(":");

    if (!kind || kind === "canvas_url") {
      return makeBaseMaterial(materialKeyValue, "canvas_url", item, canvasUrl);
    }

    const material = makeBaseMaterial(materialKeyValue, kind, item, canvasUrl);

    if (kind === "file") {
      material.fileId = compactString(materialKeyValue.slice("file:".length));
      material.fileName = compactString(item.fileName || item.filename || item.display_name || item.name || item.title);
      material.fileDownloadUrl = canvasUrl;
    }

    return material;
  }

  function getMaterialsByKind(collection, kind) {
    return asArray(collection.materials?.[kind]);
  }

  function getCourseName(collection) {
    return compactString(
      collection.courseName ||
        collection.course?.name ||
        collection.course?.course_code ||
        collection.course?.courseCode
    );
  }

  function normalizeKindUrl(item, canvasOrigin, urlHelpers) {
    return normalizeCanvasUrl(
      firstPresent(item.canvasUrl, item.htmlUrl, item.html_url, item.url),
      canvasOrigin,
      urlHelpers
    );
  }

  function makePlacement(materialKeyValue, source) {
    return {
      materialKey: materialKeyValue,
      sourceKind: compactString(source.sourceKind),
      moduleId: compactString(source.moduleId),
      moduleName: compactString(source.moduleName),
      moduleItemId: compactString(source.moduleItemId),
      position: source.position ?? null,
      label: compactString(source.label)
    };
  }

  function makeBaseMaterial(materialKeyValue, kind, item, canvasUrl) {
    return {
      materialKey: materialKeyValue,
      kind,
      title: compactString(item.title || item.name || item.display_name || item.filename),
      canvasUrl: compactString(canvasUrl),
      canvasUpdatedAt: compactString(
        item.canvasUpdatedAt ||
          item.updatedAt ||
          item.updated_at ||
          item.modified_at ||
          item.posted_at ||
          item.last_reply_at
      ),
      contentHash: compactString(item.contentHash),
      size: Number.isFinite(Number(item.size)) ? Number(item.size) : 0,
      contentType: compactString(item.contentType || item.content_type || item["content-type"]),
      body: compactString(item.body),
      fileId: "",
      fileName: "",
      fileDownloadUrl: "",
      supportedForIndexing: true
    };
  }

  function createAccumulator() {
    const materialMap = new Map();
    const placements = [];

    return {
      addMaterial(material) {
        if (!material?.materialKey || materialMap.has(material.materialKey)) {
          return;
        }

        materialMap.set(material.materialKey, material);
      },
      addPlacement(materialKeyValue, source) {
        if (!materialKeyValue) {
          return;
        }

        placements.push(makePlacement(materialKeyValue, source));
      },
      materials() {
        return Array.from(materialMap.values());
      },
      placements() {
        return placements;
      }
    };
  }

  function addFile(file, source, context, accumulator) {
    const fileId = firstPresent(file.fileId, file.id, file.contentId, file.content_id);
    const key = materialKey("file", fileId, context.keyHelpers);

    if (!key) {
      return "";
    }

    const canvasUrl = normalizeCanvasUrl(
      firstPresent(file.canvasUrl, file.htmlUrl, file.html_url, file.url),
      context.canvasOrigin,
      context.urlHelpers
    );
    const downloadUrl = normalizeCanvasUrl(
      firstPresent(file.fileDownloadUrl, file.fileDownloadPath, file.url),
      context.canvasOrigin,
      context.urlHelpers
    );
    const material = makeBaseMaterial(key, "file", file, canvasUrl);

    material.fileId = compactString(fileId);
    material.fileName = compactString(file.fileName || file.filename || file.display_name || file.name);
    material.fileDownloadUrl = downloadUrl;

    accumulator.addMaterial(material);
    accumulator.addPlacement(key, source);

    return key;
  }

  function addNativeMaterial(kind, item, source, context, accumulator) {
    const canvasUrl = normalizeKindUrl(item, context.canvasOrigin, context.urlHelpers);
    const fallbackValue = firstPresent(
      item[`${kind}Id`],
      item[`${kind}_id`],
      item.id,
      item.pageId,
      item.page_id,
      kind === "page" ? item.url : "",
      kind === "page" ? canvasUrl : ""
    );
    const key = materialKeyFromItem(
      kind,
      {
        ...item,
        htmlUrl: firstPresent(item.htmlUrl, item.html_url, item.canvasUrl, canvasUrl),
        url: kind === "page" ? firstPresent(item.url, fallbackValue) : item.url
      },
      fallbackValue,
      context.keyHelpers
    );

    if (!key) {
      return "";
    }

    accumulator.addMaterial(makeBaseMaterial(key, kind, item, canvasUrl));
    accumulator.addPlacement(key, source);

    return key;
  }

  function moduleItemKind(item) {
    const type = compactString(item.itemType || item.type).toLowerCase();

    if (type === "file") {
      return "file";
    }

    if (type === "page" || type === "wiki_page") {
      return "page";
    }

    if (type === "assignment") {
      return "assignment";
    }

    if (type === "discussion" || type === "discussion_topic") {
      return "discussion";
    }

    if (type === "announcement") {
      return "announcement";
    }

    return "";
  }

  function addModuleItem(item, context, accumulator) {
    const source = {
      sourceKind: "module",
      moduleId: item.moduleId,
      moduleName: item.moduleName,
      moduleItemId: item.id,
      position: item.position,
      label: item.title
    };
    const kind = moduleItemKind(item);

    if (kind === "file") {
      return addFile(
        {
          ...item,
          id: firstPresent(item.contentId, item.content_id),
          fileDownloadUrl: item.fileDownloadPath
        },
        source,
        context,
        accumulator
      );
    }

    if (kind) {
      return addNativeMaterial(
        kind,
        {
          ...item,
          id: firstPresent(item.contentId, item.content_id, item.id),
          htmlUrl: firstPresent(item.htmlUrl, item.pageUrl)
        },
        source,
        context,
        accumulator
      );
    }

    const fallbackUrl = normalizeCanvasUrl(
      firstPresent(item.htmlUrl, item.apiUrl, item.externalUrl),
      context.canvasOrigin,
      context.urlHelpers
    );

    if (fallbackUrl) {
      const key =
        callFirst(context.keyHelpers, ["getCanvasUrlReferencedMaterialKey"], fallbackUrl) ||
        materialKey("canvas_url", fallbackUrl, context.keyHelpers);
      accumulator.addMaterial(materialFromReferencedKey(key, item, fallbackUrl));
      accumulator.addPlacement(key, source);
      return key;
    }

    if (compactString(item.externalUrl)) {
      return "";
    }

    const key = materialKey("module_item", item.id, context.keyHelpers);

    if (!key) {
      return "";
    }

    accumulator.addMaterial(makeBaseMaterial(key, "module_item", item, ""));
    accumulator.addPlacement(key, source);

    return key;
  }

  function addFallbackLink(link, context, accumulator) {
    const normalizedUrl = normalizeCanvasUrl(link.href || link.url, context.canvasOrigin, context.urlHelpers);

    if (!normalizedUrl) {
      return "";
    }

    const key =
      callFirst(context.keyHelpers, ["getCanvasUrlReferencedMaterialKey"], normalizedUrl) ||
      materialKey("canvas_url", normalizedUrl, context.keyHelpers);

    if (!key) {
      return "";
    }

    accumulator.addMaterial({
      ...materialFromReferencedKey(key, { title: link.text || link.title }, normalizedUrl),
      supportedForIndexing: true
    });
    accumulator.addPlacement(key, {
      sourceKind: compactString(link.source?.type || "link"),
      moduleId: "",
      moduleName: "",
      moduleItemId: compactString(link.source?.id),
      position: null,
      label: compactString(link.text || link.title || normalizedUrl)
    });

    return key;
  }

  function addCollectionErrors(collectionErrors, errors) {
    return [...asArray(collectionErrors), ...asArray(errors)].map((error) => ({
      name: compactString(error.name || error.type),
      message: compactString(error.message || error.error || error)
    }));
  }

  function buildManifest(collection = {}, options = {}) {
    const urlHelpers = getHelper(options, ["urlHelpers", "url"], "CanvasManifestUrl");
    const keyHelpers = getHelper(options, ["keyHelpers", "materialKeys"], "CanvasMaterialKeys");
    const canvasOrigin = getCanvasOrigin(collection, options);
    const context = {
      canvasOrigin,
      urlHelpers,
      keyHelpers
    };
    const accumulator = createAccumulator();

    asArray(collection.files).forEach((file) =>
      addFile(file, { sourceKind: "file", label: file.title || file.filename }, context, accumulator)
    );

    getMaterialsByKind(collection, "pages").forEach((page) =>
      addNativeMaterial("page", page, { sourceKind: "page", label: page.title }, context, accumulator)
    );

    getMaterialsByKind(collection, "assignments").forEach((assignment) =>
      addNativeMaterial(
        "assignment",
        assignment,
        { sourceKind: "assignment", label: assignment.title },
        context,
        accumulator
      )
    );

    getMaterialsByKind(collection, "announcements").forEach((announcement) =>
      addNativeMaterial(
        "announcement",
        announcement,
        { sourceKind: "announcement", label: announcement.title },
        context,
        accumulator
      )
    );

    getMaterialsByKind(collection, "discussions").forEach((discussion) =>
      addNativeMaterial(
        "discussion",
        discussion,
        { sourceKind: "discussion", label: discussion.title },
        context,
        accumulator
      )
    );

    getMaterialsByKind(collection, "modules").forEach((item) =>
      addModuleItem(item, context, accumulator)
    );

    asArray(collection.links).forEach((link) => addFallbackLink(link, context, accumulator));

    return {
      canvasOrigin,
      courseId: compactString(collection.courseId),
      courseName: getCourseName(collection),
      canvasUserId: compactString(collection.canvasUserId || collection.currentUser?.id),
      localProfileId: compactString(collection.localProfileId),
      collectedAt: compactString(collection.collectedAt || new Date().toISOString()),
      materials: accumulator.materials(),
      placements: accumulator.placements(),
      collectionErrors: addCollectionErrors(collection.collectionErrors, collection.errors)
    };
  }

  const api = {
    buildManifest
  };

  globalScope.CanvasManifestBuilder = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
