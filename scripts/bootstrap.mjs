import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const start = process.argv.includes("--start");
const unknownArguments = process.argv.slice(2).filter((arg) => arg !== "--start");

if (unknownArguments.length > 0) {
  console.error(`Unknown bootstrap argument: ${unknownArguments[0]}`);
  process.exit(2);
}

const [nodeMajor, nodeMinor] = process.versions.node
  .split(".")
  .map((part) => Number(part));
if (
  !Number.isInteger(nodeMajor) ||
  !Number.isInteger(nodeMinor) ||
  nodeMajor < 22 ||
  (nodeMajor === 22 && nodeMinor < 12)
) {
  console.error(
    `Node.js 22.12 or newer is required; found ${process.version}.`,
  );
  process.exit(1);
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function runNpm(args) {
  const command =
    process.platform === "win32"
      ? (process.env.ComSpec ?? "cmd.exe")
      : npmCommand;
  const commandArgs =
    process.platform === "win32"
      ? ["/d", "/c", npmCommand, ...args]
      : args;
  const result = spawnSync(command, commandArgs, {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`Could not run ${npmCommand}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("Installing locked JavaScript dependencies...");
runNpm(["ci"]);

console.log("Preparing approved native JavaScript dependencies...");
runNpm([
  "rebuild",
  "electron-winstaller",
  "esbuild",
  "node-pty",
  "--foreground-scripts",
]);

const electronResult = spawnSync(
  process.execPath,
  [path.join(projectRoot, "scripts", "ensure-electron.mjs")],
  {
    cwd: projectRoot,
    stdio: "inherit",
  },
);
if (electronResult.error || electronResult.status !== 0) {
  if (electronResult.error) {
    console.error(
      `Could not prepare Electron: ${electronResult.error.message}`,
    );
  }
  process.exit(electronResult.status ?? 1);
}

console.log("Verifying pinned runtime dependencies in thirdparty/...");
runNpm(["run", "artifacts:verify"]);

console.log("");
console.log("Bootstrap complete.");
console.log("Run 'npm run dev' to start the app.");

if (start) {
  runNpm(["run", "dev"]);
}
