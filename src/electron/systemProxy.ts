export const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
] as const;

type ProxyEnvironment = Partial<
  Record<(typeof PROXY_ENV_KEYS)[number], string>
>;

export type SystemProxySnapshot = {
  mode: "direct" | "fixed" | "auto";
  httpProxy: string | null;
  httpsProxy: string | null;
  allProxy: string | null;
  noProxy: string[];
};

const LOCAL_BYPASS = ["localhost", "127.0.0.1", "::1"];

function cleanValue(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function proxyUrl(
  scheme: "http" | "socks5",
  host: string | undefined,
  port: string | undefined,
): string | null {
  if (!host || !port || !/^\d+$/.test(port)) return null;
  const formattedHost =
    host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${scheme}://${formattedHost}:${port}`;
}

/** Parse the effective macOS proxy dictionary printed by `scutil --proxy`. */
export function parseMacSystemProxy(output: string): SystemProxySnapshot {
  const values = new Map<string, string>();
  const exceptions: string[] = [];
  let inExceptions = false;

  for (const line of output.split(/\r?\n/)) {
    if (/^\s*ExceptionsList\s*:\s*<array>\s*\{\s*$/.test(line)) {
      inExceptions = true;
      continue;
    }
    if (inExceptions) {
      if (/^\s*\}\s*$/.test(line)) {
        inExceptions = false;
        continue;
      }
      const item = line.match(/^\s*\d+\s*:\s*(.*?)\s*$/);
      if (item?.[1]) exceptions.push(cleanValue(item[1]));
      continue;
    }
    const pair = line.match(/^\s*([A-Za-z][A-Za-z0-9]*)\s*:\s*(.*?)\s*$/);
    if (pair?.[1] && pair[2] != null) {
      values.set(pair[1], cleanValue(pair[2]));
    }
  }

  const httpProxy =
    values.get("HTTPEnable") === "1"
      ? proxyUrl("http", values.get("HTTPProxy"), values.get("HTTPPort"))
      : null;
  const httpsProxy =
    values.get("HTTPSEnable") === "1"
      ? proxyUrl("http", values.get("HTTPSProxy"), values.get("HTTPSPort"))
      : null;
  const allProxy =
    values.get("SOCKSEnable") === "1"
      ? proxyUrl("socks5", values.get("SOCKSProxy"), values.get("SOCKSPort"))
      : null;
  const noProxy = [...new Set([...LOCAL_BYPASS, ...exceptions])];
  const autoEnabled =
    values.get("ProxyAutoConfigEnable") === "1" ||
    values.get("ProxyAutoDiscoveryEnable") === "1";

  return {
    mode:
      httpProxy || httpsProxy || allProxy
        ? "fixed"
        : autoEnabled
          ? "auto"
          : "direct",
    httpProxy,
    httpsProxy,
    allProxy,
    noProxy,
  };
}

/** Convert Chromium's PAC result (`PROXY host:port; DIRECT`) to CLI variables. */
export function parseResolvedProxy(
  value: string,
  noProxy: string[] = LOCAL_BYPASS,
): SystemProxySnapshot {
  for (const entry of value.split(";")) {
    const [rawKind, rawTarget] = entry.trim().split(/\s+/, 2);
    const kind = rawKind?.toUpperCase();
    const target = rawTarget?.trim();
    if (!kind) continue;
    if (kind === "DIRECT") break;
    if (!target) continue;

    const separator = target.lastIndexOf(":");
    if (separator <= 0) continue;
    const host = target.slice(0, separator);
    const port = target.slice(separator + 1);
    if (kind === "PROXY" || kind === "HTTP" || kind === "HTTPS") {
      const proxy = proxyUrl("http", host, port);
      if (proxy) {
        return {
          mode: "fixed",
          httpProxy: proxy,
          httpsProxy: proxy,
          allProxy: null,
          noProxy,
        };
      }
    }
    if (kind === "SOCKS" || kind === "SOCKS5" || kind === "SOCKS4") {
      const proxy = proxyUrl("socks5", host, port);
      if (proxy) {
        return {
          mode: "fixed",
          httpProxy: null,
          httpsProxy: null,
          allProxy: proxy,
          noProxy,
        };
      }
    }
  }
  return {
    mode: "direct",
    httpProxy: null,
    httpsProxy: null,
    allProxy: null,
    noProxy,
  };
}

/** Read the current effective OS proxy. Null means unsupported or unreadable. */
export async function readSystemProxy(): Promise<SystemProxySnapshot | null> {
  if (process.platform !== "darwin") return null;
  try {
    const [{ execFile }, { promisify }] = await Promise.all([
      import("node:child_process"),
      import("node:util"),
    ]);
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync("/usr/sbin/scutil", ["--proxy"], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    });
    const snapshot = parseMacSystemProxy(stdout);
    if (snapshot.mode !== "auto") return snapshot;

    const { session } = await import("electron");
    session.defaultSession.forceReloadProxyConfig();
    const resolved = await session.defaultSession.resolveProxy(
      "https://api.x.ai/",
    );
    return parseResolvedProxy(resolved, snapshot.noProxy);
  } catch (error) {
    console.warn(
      "[grok-gui] could not read system proxy:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

function snapshotEnvironment(snapshot: SystemProxySnapshot): ProxyEnvironment {
  const env: ProxyEnvironment = {};
  if (snapshot.httpProxy) {
    env.HTTP_PROXY = snapshot.httpProxy;
    env.http_proxy = snapshot.httpProxy;
  }
  if (snapshot.httpsProxy) {
    env.HTTPS_PROXY = snapshot.httpsProxy;
    env.https_proxy = snapshot.httpsProxy;
  }
  if (snapshot.allProxy) {
    env.ALL_PROXY = snapshot.allProxy;
    env.all_proxy = snapshot.allProxy;
  }
  const noProxy = snapshot.noProxy.join(",");
  env.NO_PROXY = noProxy;
  env.no_proxy = noProxy;
  return env;
}

/**
 * Build a fresh child environment from the latest system proxy.
 * If macOS reports direct mode, inherited proxy variables are deliberately
 * removed so a previously enabled proxy cannot leak into the new process.
 */
export async function buildSystemProxyEnvironment(
  base: NodeJS.ProcessEnv = process.env,
  extra: NodeJS.ProcessEnv = {},
): Promise<NodeJS.ProcessEnv> {
  const snapshot = await readSystemProxy();
  if (!snapshot) return { ...base, ...extra };
  return applySystemProxyEnvironment(base, snapshot, extra);
}

export function applySystemProxyEnvironment(
  base: NodeJS.ProcessEnv,
  snapshot: SystemProxySnapshot,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of PROXY_ENV_KEYS) delete env[key];
  return { ...env, ...snapshotEnvironment(snapshot), ...extra };
}
