/**
 * One-off capability probe for candidate ACP backends.
 *
 * Installs each adapter into ignored `tmp/acp-probe/`, spawns it over stdio,
 * sends a raw ACP `initialize`, and prints the advertised capabilities.
 *
 * Raw NDJSON JSON-RPC is used on purpose: the adapters pin different
 * `@agentclientprotocol/sdk` majors than this repo, and the probe must report
 * what is actually on the wire rather than whatever our SDK version can model.
 *
 * Research tool only — nothing in src/ may depend on it.
 *
 *   node scripts/probe-acp-backends.mjs [--keep]
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const probeRoot = path.join(projectRoot, "tmp", "acp-probe");
const keep = process.argv.includes("--keep");

/** Adapters under evaluation, pinned to the versions the plan was written against. */
const BACKENDS = [
  {
    id: "codex",
    spec: "@agentclientprotocol/codex-acp@1.1.9",
    bin: "codex-acp",
    /** Keep the adapter from opening a browser mid-probe. */
    env: { NO_BROWSER: "1" },
  },
  {
    id: "claude-agent",
    // `@zed-industries/claude-code-acp` is deprecated in favour of this package,
    // which also tracks the same SDK major as codex-acp.
    spec: "@agentclientprotocol/claude-agent-acp@0.64.2",
    bin: "claude-agent-acp",
    env: {},
  },
];

const INITIALIZE_TIMEOUT_MS = 30_000;

function install() {
  if (!existsSync(probeRoot)) mkdirSync(probeRoot, { recursive: true });
  const specs = BACKENDS.map((b) => b.spec);
  console.log(`[probe] installing into ${path.relative(projectRoot, probeRoot)}`);
  const result = spawnSync(
    "npm",
    ["install", "--no-audit", "--no-fund", "--prefix", probeRoot, ...specs],
    { stdio: "inherit", cwd: projectRoot },
  );
  if (result.status !== 0) {
    throw new Error(`npm install failed with status ${result.status}`);
  }
}

/**
 * Speak just enough ACP to get an `initialize` result back.
 * Resolves with the raw response object (or an error payload) and any stderr.
 */
function probe(backend) {
  return new Promise((resolve) => {
    const binPath = path.join(probeRoot, "node_modules", ".bin", backend.bin);
    if (!existsSync(binPath)) {
      resolve({ id: backend.id, error: `bin not found: ${binPath}` });
      return;
    }

    const child = spawn(binPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...backend.env },
      cwd: projectRoot,
    });

    let stdoutBuf = "";
    let stderrBuf = "";
    let settled = false;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGTERM");
      } catch {
        // already gone
      }
      resolve({ id: backend.id, stderr: stderrBuf.trim(), ...payload });
    };

    const timer = setTimeout(
      () => finish({ error: `timeout after ${INITIALIZE_TIMEOUT_MS}ms` }),
      INITIALIZE_TIMEOUT_MS,
    );

    child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk.toString("utf8");
      // NDJSON: one JSON-RPC message per line.
      let newline;
      while ((newline = stdoutBuf.indexOf("\n")) >= 0) {
        const line = stdoutBuf.slice(0, newline).trim();
        stdoutBuf = stdoutBuf.slice(newline + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue; // non-JSON banner output
        }
        if (message.id === 1) finish({ response: message });
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString("utf8");
    });

    child.on("error", (error) => finish({ error: error.message }));
    child.on("exit", (code, signal) =>
      finish({ error: `exited early (code=${code ?? "?"}, signal=${signal ?? "none"})` }),
    );

    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: { name: "grok-gui-probe", version: "0.0.0" },
        },
      })}\n`,
    );
  });
}

/** The specific questions Phase 0 exists to answer. */
function summarize(result) {
  const caps = result.response?.result?.agentCapabilities;
  if (!caps) return null;
  const session = caps.sessionCapabilities ?? {};
  return {
    protocolVersion: result.response.result.protocolVersion,
    providers: caps.providers !== undefined && caps.providers !== null,
    loadSession: caps.loadSession === true,
    "session/list": session.list !== undefined && session.list !== null,
    "session/delete": session.delete !== undefined && session.delete !== null,
    "session/fork": session.fork !== undefined && session.fork !== null,
    "session/resume": session.resume !== undefined && session.resume !== null,
    configOptions:
      session.configOptions !== undefined && session.configOptions !== null,
    promptCapabilities: caps.promptCapabilities ?? null,
    mcpCapabilities: caps.mcpCapabilities ?? null,
    authMethods: result.response.result.authMethods?.map((m) => m.id) ?? [],
  };
}

async function main() {
  install();

  const summaries = {};
  for (const backend of BACKENDS) {
    console.log(`\n${"=".repeat(70)}\n[probe] ${backend.spec}\n${"=".repeat(70)}`);
    const result = await probe(backend);

    if (result.error) console.log(`ERROR: ${result.error}`);
    if (result.stderr) console.log(`--- stderr ---\n${result.stderr}`);
    if (result.response) {
      console.log("--- initialize response ---");
      console.log(JSON.stringify(result.response, null, 2));
    }

    const summary = summarize(result);
    if (summary) summaries[backend.id] = summary;
  }

  console.log(`\n${"=".repeat(70)}\nCAPABILITY MATRIX\n${"=".repeat(70)}`);
  console.log(JSON.stringify(summaries, null, 2));

  if (!keep) rmSync(probeRoot, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
