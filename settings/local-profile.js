(function initCanvasLocalProfileSettings(globalScope) {
  const STORAGE_KEY = "canvasGptLocalProfileId";
  const PROFILE_ID_PREFIX = "local_profile_";

  function getStorageArea() {
    return globalScope.chrome?.storage?.local;
  }

  function normalizeLocalProfileId(value) {
    const normalized = value === undefined || value === null ? "" : String(value).trim();

    return normalized.startsWith(PROFILE_ID_PREFIX) ? normalized : "";
  }

  function getRandomHex(length) {
    const cryptoApi = globalScope.crypto;
    const byteLength = Math.ceil(length / 2);
    const bytes = new Uint8Array(byteLength);

    if (typeof cryptoApi?.getRandomValues === "function") {
      cryptoApi.getRandomValues(bytes);
    } else {
      for (let index = 0; index < byteLength; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }

    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, length);
  }

  function createLocalProfileId() {
    const randomUuid =
      typeof globalScope.crypto?.randomUUID === "function"
        ? globalScope.crypto.randomUUID().replace(/-/g, "")
        : getRandomHex(32);

    return `${PROFILE_ID_PREFIX}${randomUuid}`;
  }

  async function getStoredLocalProfileId() {
    const storage = getStorageArea();

    if (!storage) {
      return "";
    }

    const result = await storage.get(STORAGE_KEY);
    return normalizeLocalProfileId(result?.[STORAGE_KEY]);
  }

  async function getOrCreateLocalProfileId() {
    const storage = getStorageArea();

    if (!storage) {
      throw new Error("Chrome local storage is unavailable.");
    }

    const existingProfileId = await getStoredLocalProfileId();

    if (existingProfileId) {
      return existingProfileId;
    }

    const localProfileId = createLocalProfileId();
    await storage.set({ [STORAGE_KEY]: localProfileId });

    return localProfileId;
  }

  const api = {
    STORAGE_KEY,
    createLocalProfileId,
    getStoredLocalProfileId,
    getOrCreateLocalProfileId,
    normalizeLocalProfileId
  };

  globalScope.CanvasLocalProfileSettings = api;

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
