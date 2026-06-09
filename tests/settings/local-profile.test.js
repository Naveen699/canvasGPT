import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function createStorage(initialValues = {}) {
  const values = { ...initialValues };

  return {
    values,
    async get(key) {
      return { [key]: values[key] };
    },
    async set(update) {
      Object.assign(values, update);
    }
  };
}

function loadLocalProfileSettings(storage, randomUUID = () => "11111111-2222-4333-8444-555555555555") {
  const source = readFileSync(resolve("settings/local-profile.js"), "utf8");
  const context = {
    Uint8Array,
    Math,
    module: { exports: {} },
    chrome: {
      storage: {
        local: storage
      }
    },
    crypto: {
      randomUUID
    }
  };

  runInNewContext(source, context);

  return context.module.exports;
}

describe("CanvasLocalProfileSettings", () => {
  it("creates and persists a local profile id when none exists", async () => {
    const storage = createStorage();
    const localProfile = loadLocalProfileSettings(storage);

    await expect(localProfile.getOrCreateLocalProfileId()).resolves.toBe(
      "local_profile_11111111222243338444555555555555"
    );
    expect(storage.values[localProfile.STORAGE_KEY]).toBe(
      "local_profile_11111111222243338444555555555555"
    );
  });

  it("reuses a previously persisted local profile id", async () => {
    const storage = createStorage({
      canvasGptLocalProfileId: "local_profile_existing"
    });
    const localProfile = loadLocalProfileSettings(storage, () => {
      throw new Error("should not generate a replacement id");
    });

    await expect(localProfile.getOrCreateLocalProfileId()).resolves.toBe(
      "local_profile_existing"
    );
  });

  it("rejects malformed stored profile ids", async () => {
    const storage = createStorage({
      canvasGptLocalProfileId: "canvas_user_123"
    });
    const localProfile = loadLocalProfileSettings(storage);

    expect(await localProfile.getStoredLocalProfileId()).toBe("");
  });
});
