import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const rootDir = __dirname;
const distDir = resolve(rootDir, "dist");

function copyExtensionAssets(): Plugin {
  return {
    name: "copy-extension-assets",
    closeBundle() {
      const manifest = JSON.parse(readFileSync(resolve(rootDir, "manifest.json"), "utf8"));

      manifest.background = {
        service_worker: "background.js",
        type: "module"
      };
      manifest.content_scripts = [
        {
          matches: ["https://*.instructure.com/*", "https://canvas.case.edu/*"],
          js: ["canvas/detect.js", "content/canvasApiClient.js", "content/content.js"],
          run_at: "document_idle"
        }
      ];
      manifest.side_panel = {
        default_path: "sidepanel/sidepanel.html"
      };

      writeFileSync(
        resolve(distDir, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`
      );

      copyFile("icons/icon.svg", "icons/icon.svg");
      copyFile("canvas/detect.js", "canvas/detect.js");
      copyFile("content/canvasApiClient.js", "content/canvasApiClient.js");
      copyFile("sidepanel/sidepanel.css", "sidepanel/sidepanel.css");

      const sidepanelHtml = readFileSync(resolve(rootDir, "sidepanel/sidepanel.html"), "utf8");

      writeFile("sidepanel/sidepanel.html", sidepanelHtml);
    }
  };
}

function copyFile(source: string, target: string): void {
  const targetPath = resolve(distDir, target);
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(resolve(rootDir, source), targetPath);
}

function writeFile(target: string, contents: string): void {
  const targetPath = resolve(distDir, target);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, contents);
}

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(rootDir, "background.ts"),
        "content/content": resolve(rootDir, "content/content.ts"),
        "sidepanel/sidepanel": resolve(rootDir, "sidepanel/sidepanel.ts"),
        "canvas/runtime": resolve(rootDir, "canvas/runtime.ts")
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  },
  plugins: [
    {
      name: "clean-dist-before-extension-build",
      buildStart() {
        rmSync(distDir, { recursive: true, force: true });
      }
    },
    copyExtensionAssets()
  ]
});
