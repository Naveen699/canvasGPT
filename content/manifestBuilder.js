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

  function toUtf8Bytes(value) {
    const text = String(value);

    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(text);
    }

    const encoded = encodeURIComponent(text);
    const bytes = [];

    for (let index = 0; index < encoded.length; index += 1) {
      if (encoded[index] === "%") {
        bytes.push(parseInt(encoded.slice(index + 1, index + 3), 16));
        index += 2;
      } else {
        bytes.push(encoded.charCodeAt(index));
      }
    }

    return bytes;
  }

  function rightRotate(value, bits) {
    return (value >>> bits) | (value << (32 - bits));
  }

  function sha256Hex(value) {
    const constants = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
      0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
      0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
      0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
      0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
      0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    const hash = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];
    const bytes = Array.from(toUtf8Bytes(value));
    const bitLength = bytes.length * 8;

    bytes.push(0x80);

    while (bytes.length % 64 !== 56) {
      bytes.push(0);
    }

    const highBits = Math.floor(bitLength / 0x100000000);
    const lowBits = bitLength >>> 0;

    for (let shift = 24; shift >= 0; shift -= 8) {
      bytes.push((highBits >>> shift) & 0xff);
    }

    for (let shift = 24; shift >= 0; shift -= 8) {
      bytes.push((lowBits >>> shift) & 0xff);
    }

    for (let chunk = 0; chunk < bytes.length; chunk += 64) {
      const words = new Array(64).fill(0);

      for (let index = 0; index < 16; index += 1) {
        const offset = chunk + index * 4;
        words[index] =
          ((bytes[offset] << 24) |
            (bytes[offset + 1] << 16) |
            (bytes[offset + 2] << 8) |
            bytes[offset + 3]) >>>
          0;
      }

      for (let index = 16; index < 64; index += 1) {
        const s0 =
          rightRotate(words[index - 15], 7) ^
          rightRotate(words[index - 15], 18) ^
          (words[index - 15] >>> 3);
        const s1 =
          rightRotate(words[index - 2], 17) ^
          rightRotate(words[index - 2], 19) ^
          (words[index - 2] >>> 10);
        words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
      }

      let [a, b, c, d, e, f, g, h] = hash;

      for (let index = 0; index < 64; index += 1) {
        const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + s1 + ch + constants[index] + words[index]) >>> 0;
        const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (s0 + maj) >>> 0;

        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }

      hash[0] = (hash[0] + a) >>> 0;
      hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0;
      hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0;
      hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0;
      hash[7] = (hash[7] + h) >>> 0;
    }

    return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
  }

  function normalizeNativeBody(value) {
    return compactString(value)
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n");
  }

  function contentHashForNativeBody(body) {
    const normalizedBody = normalizeNativeBody(body);

    return normalizedBody ? `sha256:${sha256Hex(normalizedBody)}` : "";
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

  function firstPresentValue(...values) {
    return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
  }

  function makeModulePlacementSource(item) {
    return {
      sourceKind: "module",
      moduleId: firstPresentValue(item.moduleId, item.module_id, item.module?.id, item.raw?.module_id),
      moduleName: firstPresentValue(item.moduleName, item.module_name, item.module?.name, item.raw?.module_name),
      moduleItemId: firstPresentValue(item.moduleItemId, item.module_item_id, item.id, item.raw?.id),
      position: firstPresentValue(item.position, item.raw?.position) ?? null,
      label: firstPresentValue(item.label, item.title, item.name, item.raw?.title)
    };
  }

  function makeBaseMaterial(materialKeyValue, kind, item, canvasUrl) {
    const body = normalizeNativeBody(item.body || item.description || item.message);
    const isFile = kind === "file";
    const isNative = ["announcement", "assignment", "discussion", "module_item", "page"].includes(kind);

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
      contentHash: isFile ? "" : compactString(item.contentHash) || (isNative ? contentHashForNativeBody(body) : ""),
      size: Number.isFinite(Number(item.size)) ? Number(item.size) : 0,
      contentType: compactString(item.contentType || item.content_type || item["content-type"]),
      body,
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
    if (
      kind === "discussion" &&
      callFirst(context.keyHelpers, ["getDiscussionMaterialKey"], item) === null
    ) {
      return "";
    }

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
    const source = makeModulePlacementSource(item);
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

  function normalizeCollectionError(error) {
    const normalized = {
      name: compactString(error?.name || error?.type),
      message: compactString(error?.message || error?.error || error)
    };
    const moduleId = compactString(error?.moduleId || error?.module_id);
    const moduleName = compactString(error?.moduleName || error?.module_name);

    if (moduleId) {
      normalized.moduleId = moduleId;
    }

    if (moduleName) {
      normalized.moduleName = moduleName;
    }

    return normalized;
  }

  function getModuleItemLoadErrors(modules) {
    return asArray(modules)
      .filter((module) => compactString(module?.itemsLoadError))
      .map((module) => ({
        name: "module_items",
        message: compactString(module.itemsLoadError),
        moduleId: compactString(module.id),
        moduleName: compactString(module.name)
      }));
  }

  function getCollectionErrors(collection) {
    const seen = new Set();

    return [
      ...asArray(collection.collectionErrors),
      ...asArray(collection.errors),
      ...getModuleItemLoadErrors(collection.modules)
    ]
      .map(normalizeCollectionError)
      .filter((error) => error.name || error.message)
      .filter((error) => {
        const key = [
          error.name,
          error.message,
          error.moduleId || "",
          error.moduleName || ""
        ].join("\u001f");

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      });
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
    const canvasUserId = compactString(collection.canvasUserId || collection.currentUser?.id);

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
      canvasUserId,
      localProfileId: canvasUserId ? "" : compactString(collection.localProfileId),
      collectedAt: compactString(collection.collectedAt || new Date().toISOString()),
      materials: accumulator.materials(),
      placements: accumulator.placements(),
      collectionErrors: getCollectionErrors(collection)
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
