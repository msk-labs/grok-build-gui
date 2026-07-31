import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import path from "node:path";

const projectRoot = path.resolve(__dirname, "..");
const rendererRoot = path.join(projectRoot, "src", "renderer");
const electronRoot = path.join(projectRoot, "src", "electron");
const browserIntegrationBuild =
  process.env.GROK_GUI_BROWSER_INTEGRATION === "1";
const buildRoot = browserIntegrationBuild
  ? path.join(projectRoot, "out", "browser-integration")
  : path.join(projectRoot, "out");
const rendererOut = path.join(buildRoot, "renderer");
const electronOut = path.join(buildRoot, "electron");

export default defineConfig({
  root: rendererRoot,
  cacheDir: path.join(projectRoot, "node_modules", ".vite"),
  build: {
    outDir: rendererOut,
    emptyOutDir: true,
  },
  plugins: [
    react(),
    ...(process.env.VITEST
      ? []
      : [
          electron({
            main: {
              entry: {
                main: path.join(electronRoot, "main.ts"),
                browserMcpServer: path.join(electronRoot, "browserMcpServer.ts"),
                ...(browserIntegrationBuild
                  ? {
                      browserIntegrationHarness: path.join(
                        electronRoot,
                        "browserIntegrationHarness.ts",
                      ),
                    }
                  : {}),
              },
              vite: {
                build: {
                  outDir: electronOut,
                  emptyOutDir: false,
                  rollupOptions: {
                    // Native modules — load from node_modules at runtime (not bundled).
                    // koffi: optional, Windows window-snap only (dynamic import chain).
                    // electron-updater resolves `app-update.yml` relative to its
                    // real module path, so it must not be bundled either.
                    external: [
                      "electron",
                      "node-pty",
                      "koffi",
                      "electron-updater",
                    ],
                  },
                },
              },
            },
            preload: {
              // Electron preload must be CJS (not ESM .mjs) — `require` is used by the bundle.
              input: path.join(electronRoot, "preload.ts"),
              vite: {
                build: {
                  outDir: electronOut,
                  emptyOutDir: false,
                  rollupOptions: {
                    output: {
                      format: "cjs",
                      entryFileNames: "[name].cjs",
                      inlineDynamicImports: true,
                    },
                  },
                },
              },
            },
            renderer: {},
          }),
        ]),
  ],
  resolve: {
    alias: {
      "@": rendererRoot,
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [projectRoot],
    },
  },
});
