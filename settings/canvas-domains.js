(function initCanvasDomainSettings(globalScope) {
  const STORAGE_KEY = "canvasDomainPatterns";

  function getStorageArea() {
    return globalScope.chrome?.storage?.sync || globalScope.chrome?.storage?.local;
  }

  function validateCanvasDomain(domain) {
    const validation = globalScope.CanvasDetection?.validateDomainPattern(domain);

    if (!validation?.valid) {
      throw new Error(validation?.error || "Use a valid Canvas hostname.");
    }

    return validation.value;
  }

  async function getConfiguredCanvasDomains() {
    const storage = getStorageArea();

    if (!storage) {
      return [];
    }

    const result = await storage.get(STORAGE_KEY);
    const storedDomains = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
    const validDomains = storedDomains.flatMap((domain) => {
      try {
        return [validateCanvasDomain(domain)];
      } catch {
        return [];
      }
    });
    const uniqueDomains = Array.from(new Set(validDomains));

    if (JSON.stringify(uniqueDomains) !== JSON.stringify(storedDomains)) {
      await storage.set({ [STORAGE_KEY]: uniqueDomains });
    }

    return uniqueDomains;
  }

  async function saveConfiguredCanvasDomains(domains) {
    const storage = getStorageArea();

    if (!storage) {
      throw new Error("Chrome storage is unavailable.");
    }

    const validatedDomains = domains.map(validateCanvasDomain);
    const normalizedDomains = Array.from(
      new Set(
        validatedDomains.filter(Boolean)
      )
    );

    await storage.set({ [STORAGE_KEY]: normalizedDomains });
    return normalizedDomains;
  }

  async function addConfiguredCanvasDomain(domain) {
    const existingDomains = await getConfiguredCanvasDomains();
    return saveConfiguredCanvasDomains([...existingDomains, domain]);
  }

  globalScope.CanvasDomainSettings = {
    STORAGE_KEY,
    getConfiguredCanvasDomains,
    saveConfiguredCanvasDomains,
    addConfiguredCanvasDomain
  };
})(globalThis);
