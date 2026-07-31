import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const projectRoot = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const electronPath = require("electron");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`,
        ),
      );
    });
  });
}

const scratch = await mkdtemp(path.join(tmpdir(), "grok-browser-integration-"));
const resultPath = path.join(scratch, "result.json");
const integrationOut = path.join(projectRoot, "out", "browser-integration");

try {
  await run(
    process.execPath,
    [
      path.join(projectRoot, "node_modules", "vite", "bin", "vite.js"),
      "build",
      "--config",
      path.join(projectRoot, "config", "vite.config.ts"),
    ],
    {
    env: {
      ...process.env,
      GROK_GUI_BROWSER_INTEGRATION: "1",
    },
    },
  );

  const electronEnv = {
    ...process.env,
    GROK_GUI_BROWSER_INTEGRATION_RESULT: resultPath,
  };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  try {
    await run(
      electronPath,
      [path.join(integrationOut, "electron", "browserIntegrationHarness.js")],
      { env: electronEnv },
    );
  } catch (error) {
    const failure = await readFile(resultPath, "utf8")
      .then((text) => JSON.parse(text))
      .catch(() => null);
    if (failure?.error) {
      throw new Error(failure.error, { cause: error });
    }
    throw error;
  }

  const result = JSON.parse(await readFile(resultPath, "utf8"));
  if (!result.ok) {
    throw new Error(result.error || "Browser integration harness failed.");
  }
  console.log(
    `Browser integration smoke passed (${result.checks.length} checks on a local fixture).`,
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
  await rm(integrationOut, { recursive: true, force: true });
}
