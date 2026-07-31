/**
 * Serve a throwaway update feed so `npm run dev` can exercise the auto-update
 * path without cutting a release.
 *
 * Writes `dev-app-update.yml` (gitignored) pointing at this server, fabricates
 * a release archive of `--size` MB, and serves both. An unpackaged run picks
 * the file up via `forceDevUpdateConfig` — see src/electron/updater.ts.
 *
 *   node scripts/dev-update-feed.mjs [--version 9.9.9] [--port 8099] [--size 40]
 *
 * Then `npm run dev` in another terminal. The update button appears a few
 * seconds after launch; clicking it downloads this archive for real, so the
 * progress ring is driven by genuine bytes. Installing still needs a packaged
 * build — dev has no bundle for Squirrel to replace.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const version = arg("version", "9.9.9");
const port = Number(arg("port", "8099"));
const sizeMb = Number(arg("size", "40"));
const archiveName = `Grok-Build-GUI-${version}-mac-arm64.zip`;

// Big enough that the progress ring visibly fills over a local connection.
const archive = Buffer.concat(
  Array.from({ length: sizeMb }, () => randomBytes(1024 * 1024)),
);
const sha512 = createHash("sha512").update(archive).digest("base64");

const feed = [
  `version: ${version}`,
  "files:",
  `  - url: ${archiveName}`,
  `    sha512: ${sha512}`,
  `    size: ${archive.length}`,
  `path: ${archiveName}`,
  `sha512: ${sha512}`,
  "releaseDate: '2026-01-01T00:00:00.000Z'",
  "",
].join("\n");

const devConfig = path.join(projectRoot, "dev-app-update.yml");
writeFileSync(
  devConfig,
  `provider: generic\nurl: http://localhost:${port}\n`,
);

const server = createServer((req, res) => {
  const name = (req.url ?? "/").split("?")[0].replace(/^\//, "");
  console.log(`  → ${name || "/"}`);
  if (name === "latest-mac.yml") {
    res.writeHead(200, { "content-type": "text/yaml" });
    res.end(feed);
    return;
  }
  if (name === archiveName) {
    res.writeHead(200, {
      "content-type": "application/zip",
      "content-length": String(archive.length),
    });
    res.end(archive);
    return;
  }
  res.writeHead(404).end();
});

server.listen(port, () => {
  console.log(`Fake update feed on http://localhost:${port}`);
  console.log(`  version   ${version} (local app is ${localVersion()})`);
  console.log(`  archive   ${archiveName} — ${sizeMb} MB`);
  console.log(`  wrote     ${path.relative(projectRoot, devConfig)}`);
  console.log(`\nRun \`npm run dev\` in another terminal.`);
  console.log(`Ctrl-C here, then delete dev-app-update.yml when done.\n`);
});

function localVersion() {
  try {
    const pkg = readFileSync(path.join(projectRoot, "package.json"), "utf8");
    return JSON.parse(pkg).version;
  } catch {
    return "unknown";
  }
}
