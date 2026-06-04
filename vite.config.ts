import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const rootDir = __dirname;
const distDir = resolve(rootDir, "dist");

const extensionFiles = [
  "manifest.json",
  "background.js",
  "canvas/detect.js",
  "canvas/collect/types.js",
  "canvas/collect/status.js",
  "canvas/collect/active-page.js",
  "content/canvasApiClient.js",
  "content/content.js",
  "settings/canvas-domains.js",
  "sidepanel/sidepanel.html",
  "sidepanel/sidepanel.css",
  "sidepanel/sidepanel.js",
  "icons/icon.svg"
];

function copyExtensionFile(source: string): void {
  const sourcePath = resolve(rootDir, source);
  const targetPath = resolve(distDir, source);

  if (!existsSync(sourcePath)) {
    return;
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
}

function copyExtensionAssets(): Plugin {
  return {
    name: "copy-extension-assets",
    buildStart() {
      rmSync(distDir, { recursive: true, force: true });
    },
    closeBundle() {
      extensionFiles.forEach(copyExtensionFile);
    }
  };
}

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(rootDir, "sidepanel/sidepanel.html")
    }
  },
  plugins: [copyExtensionAssets()]
});
