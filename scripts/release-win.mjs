import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const packageJson = JSON.parse(
  readFileSync(path.join(projectRoot, "package.json"), "utf8"),
);
const releaseDir = path.join(projectRoot, "out", "release");
const installerPath = path.join(
  releaseDir,
  `Grok-Build-GUI-${packageJson.version}-win-x64-setup.exe`,
);
const electronBuilder = path.join(
  projectRoot,
  "node_modules",
  "electron-builder",
  "out",
  "cli",
  "cli.js",
);
const npmCli = process.env.npm_execpath;

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("The Windows x64 installer must run on Windows x64.");
}
if (!npmCli || !existsSync(npmCli)) {
  throw new Error("Run this release script through npm run package:win.");
}

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...options.env,
    },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(command)} failed with exit code ${result.status}.`,
    );
  }
}

run(process.execPath, [npmCli, "run", "build"]);
run(process.execPath, [npmCli, "run", "artifacts:verify"]);

rmSync(installerPath, { force: true });
run(
  process.execPath,
  [
    electronBuilder,
    "--config",
    "config/electron-builder.cjs",
    "--win",
    "nsis",
    "--x64",
    "--publish",
    "never",
  ],
  {
    env: {
      CSC_IDENTITY_AUTO_DISCOVERY: "false",
    },
  },
);

if (!existsSync(installerPath)) {
  throw new Error(`Expected installer was not created at ${installerPath}.`);
}

console.log(`\nUnsigned Windows installer ready: ${installerPath}`);
