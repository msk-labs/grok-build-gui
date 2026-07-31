import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { findGrok } from "./findGrok.js";
import { buildSystemProxyEnvironment } from "./systemProxy.js";

const execFileAsync = promisify(execFile);

/** Installed plugin row from `grok plugin list --json`. */
export type InstalledPlugin = {
  status: "installed";
  name: string;
  repoKey: string | null;
  version: string | null;
  path: string | null;
  source: string | null;
  marketplace: string | null;
  description: string | null;
  /** From `grok inspect --json` plugins[].enabled when available. */
  enabled: boolean;
  skillCount: number;
  agentCount: number;
  mcpServerCount: number;
  hasHooks: boolean;
};

/** Marketplace / not-yet-installed entry from `grok plugin list --json --available`. */
export type AvailablePlugin = {
  status: "available";
  name: string;
  version: string | null;
  description: string | null;
  marketplace: string | null;
  skillCount: number;
  hasHooks: boolean;
  hasAgents: boolean;
  hasMcp: boolean;
};

export type PluginListResult = {
  ok: true;
  installed: InstalledPlugin[];
  available: AvailablePlugin[];
} | {
  ok: false;
  error: string;
};

export type PluginActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function asNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

async function runGrok(
  args: string[],
  opts?: { timeout?: number },
): Promise<{ ok: true; stdout: string; stderr: string } | { ok: false; error: string }> {
  const probe = findGrok();
  if (!probe) return { ok: false, error: "Grok binary not found" };
  try {
    const env = await buildSystemProxyEnvironment();
    const { stdout, stderr } = await execFileAsync(probe.path, args, {
      encoding: "utf8",
      timeout: opts?.timeout ?? 60_000,
      maxBuffer: 16 * 1024 * 1024,
      env,
    });
    return { ok: true, stdout: stdout ?? "", stderr: stderr ?? "" };
  } catch (e) {
    const err = e as {
      message?: string;
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    const detail =
      (typeof err.stderr === "string" && err.stderr.trim()) ||
      (typeof err.stdout === "string" && err.stdout.trim()) ||
      err.message ||
      String(e);
    return { ok: false, error: detail };
  }
}

function parseJsonArray(raw: string): unknown[] {
  const text = raw.trim();
  if (!text) return [];
  try {
    const data = JSON.parse(text) as unknown;
    return Array.isArray(data) ? data : [];
  } catch {
    // Some builds may print warnings before JSON — try last `[...]` block.
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start >= 0 && end > start) {
      try {
        const data = JSON.parse(text.slice(start, end + 1)) as unknown;
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    }
    return [];
  }
}

type InspectPlugin = {
  name?: unknown;
  enabled?: unknown;
  description?: unknown;
  provides?: {
    skills?: unknown;
    agents?: unknown;
    hooks?: unknown;
    mcpServers?: unknown;
  };
};

/** Parse `[plugins] enabled = [...]` / `disabled = [...]` from user config. */
function loadConfigEnableState(): {
  enabled: Set<string>;
  disabled: Set<string>;
} {
  const enabled = new Set<string>();
  const disabled = new Set<string>();
  try {
    const text = readFileSync(join(homedir(), ".grok", "config.toml"), "utf8");
    const section = text.match(/\[plugins\]([\s\S]*?)(?=\n\[|\s*$)/);
    if (!section) return { enabled, disabled };
    const body = section[1] ?? "";
    const en = body.match(/^\s*enabled\s*=\s*\[([^\]]*)\]/m);
    const dis = body.match(/^\s*disabled\s*=\s*\[([^\]]*)\]/m);
    const parseList = (raw: string | undefined, into: Set<string>) => {
      if (!raw) return;
      for (const m of raw.matchAll(/"([^"]+)"|'([^']+)'/g)) {
        const name = (m[1] || m[2] || "").trim().toLowerCase();
        if (name) into.add(name);
      }
    };
    parseList(en?.[1], enabled);
    parseList(dis?.[1], disabled);
  } catch {
    // no config — all plugins default disabled
  }
  return { enabled, disabled };
}

function isPluginEnabled(
  name: string,
  config: { enabled: Set<string>; disabled: Set<string> },
  inspectEnabled: boolean | undefined,
): boolean {
  const key = name.toLowerCase();
  // Explicit config wins (matches `grok plugin enable/disable`).
  if (config.disabled.has(key)) return false;
  if (config.enabled.has(key)) return true;
  // Default for installed plugins is off unless listed in enabled.
  // Fall back to inspect only when config has no opinion and inspect knows.
  if (inspectEnabled !== undefined && config.enabled.size === 0 && config.disabled.size === 0) {
    return inspectEnabled;
  }
  return false;
}

async function loadInspectPluginMap(): Promise<
  Map<string, { enabled: boolean; description: string | null; provides: InspectPlugin["provides"] }>
> {
  const map = new Map<
    string,
    { enabled: boolean; description: string | null; provides: InspectPlugin["provides"] }
  >();
  const result = await runGrok(["inspect", "--json"], { timeout: 25_000 });
  if (!result.ok) return map;
  try {
    const data = JSON.parse(result.stdout) as { plugins?: InspectPlugin[] };
    const plugins = Array.isArray(data.plugins) ? data.plugins : [];
    for (const p of plugins) {
      const name = asString(p.name)?.toLowerCase();
      if (!name) continue;
      map.set(name, {
        enabled: p.enabled !== false,
        description: asString(p.description),
        provides: p.provides,
      });
    }
  } catch {
    // ignore parse errors — list still works without enable flags
  }
  return map;
}

function parseInstalledRow(
  row: Record<string, unknown>,
  inspect: Awaited<ReturnType<typeof loadInspectPluginMap>>,
  config: { enabled: Set<string>; disabled: Set<string> },
): InstalledPlugin | null {
  const name = asString(row.name);
  if (!name) return null;
  const meta = inspect.get(name.toLowerCase());
  const provides = meta?.provides;
  return {
    status: "installed",
    name,
    repoKey: asString(row.repo_key) ?? asString(row.repoKey),
    version: asString(row.version),
    path: asString(row.path),
    source: asString(row.source),
    marketplace: asString(row.marketplace),
    description: meta?.description ?? asString(row.description),
    enabled: isPluginEnabled(name, config, meta?.enabled),
    skillCount: asNumber(provides?.skills) || asNumber(row.skill_count),
    agentCount: asNumber(provides?.agents) || asNumber(row.agent_count),
    mcpServerCount: asNumber(provides?.mcpServers) || asNumber(row.mcp_server_count),
    hasHooks:
      provides?.hooks === true ||
      row.has_hooks === true ||
      asNumber(row.hook_count) > 0,
  };
}

function parseAvailableRow(row: Record<string, unknown>): AvailablePlugin | null {
  if (asString(row.status) !== "available") return null;
  const name = asString(row.name);
  if (!name) return null;
  return {
    status: "available",
    name,
    version: asString(row.version),
    description: asString(row.description),
    marketplace: asString(row.marketplace),
    skillCount: asNumber(row.skill_count),
    hasHooks: row.has_hooks === true,
    hasAgents: row.has_agents === true,
    hasMcp: row.has_mcp === true,
  };
}

/** List installed + marketplace-available plugins. */
export async function listPlugins(): Promise<PluginListResult> {
  const [installedRes, availableRes, inspect] = await Promise.all([
    runGrok(["plugin", "list", "--json"]),
    runGrok(["plugin", "list", "--json", "--available"], { timeout: 90_000 }),
    loadInspectPluginMap(),
  ]);
  const config = loadConfigEnableState();

  if (!installedRes.ok && !availableRes.ok) {
    return {
      ok: false,
      error: installedRes.ok === false ? installedRes.error : availableRes.error,
    };
  }

  const installed: InstalledPlugin[] = [];
  if (installedRes.ok) {
    for (const item of parseJsonArray(installedRes.stdout)) {
      if (!item || typeof item !== "object") continue;
      const row = parseInstalledRow(
        item as Record<string, unknown>,
        inspect,
        config,
      );
      if (row) installed.push(row);
    }
  }

  const installedNames = new Set(installed.map((p) => p.name.toLowerCase()));
  const available: AvailablePlugin[] = [];
  if (availableRes.ok) {
    for (const item of parseJsonArray(availableRes.stdout)) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      // --available also echoes installed rows; skip those.
      const name = asString(rec.name);
      if (name && installedNames.has(name.toLowerCase())) continue;
      const row = parseAvailableRow(rec);
      if (row) available.push(row);
    }
  }

  installed.sort((a, b) => a.name.localeCompare(b.name));
  available.sort((a, b) => a.name.localeCompare(b.name));

  return { ok: true, installed, available };
}

export async function installPlugin(source: string): Promise<PluginActionResult> {
  const src = source.trim();
  if (!src) return { ok: false, error: "Source is required" };
  // --trust: GUI already confirmed; CLI would otherwise refuse non-interactive install.
  const result = await runGrok(["plugin", "install", src, "--trust"], {
    timeout: 180_000,
  });
  if (!result.ok) return result;
  const message = (result.stdout || result.stderr || "Installed").trim();
  return { ok: true, message: message.slice(0, 500) };
}

export async function uninstallPlugin(name: string): Promise<PluginActionResult> {
  const n = name.trim();
  if (!n) return { ok: false, error: "Plugin name is required" };
  const result = await runGrok(["plugin", "uninstall", n, "--confirm"]);
  if (!result.ok) return result;
  return {
    ok: true,
    message: (result.stdout || result.stderr || `Uninstalled ${n}`).trim().slice(0, 500),
  };
}

export async function enablePlugin(name: string): Promise<PluginActionResult> {
  const n = name.trim();
  if (!n) return { ok: false, error: "Plugin name is required" };
  const result = await runGrok(["plugin", "enable", n]);
  if (!result.ok) return result;
  return {
    ok: true,
    message: (result.stdout || `Enabled ${n}`).trim().slice(0, 500),
  };
}

export async function disablePlugin(name: string): Promise<PluginActionResult> {
  const n = name.trim();
  if (!n) return { ok: false, error: "Plugin name is required" };
  const result = await runGrok(["plugin", "disable", n]);
  if (!result.ok) return result;
  return {
    ok: true,
    message: (result.stdout || `Disabled ${n}`).trim().slice(0, 500),
  };
}
