import { describe, expect, it } from "vitest";
import {
  applySystemProxyEnvironment,
  parseMacSystemProxy,
  parseResolvedProxy,
} from "./systemProxy";

describe("parseMacSystemProxy", () => {
  it("maps enabled HTTP, HTTPS, SOCKS, and bypass settings", () => {
    const snapshot = parseMacSystemProxy(`
<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 10.0.0.0/8
  }
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7890
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 1
  SOCKSPort : 7891
  SOCKSProxy : ::1
}
`);

    expect(snapshot).toEqual({
      mode: "fixed",
      httpProxy: "http://127.0.0.1:7890",
      httpsProxy: "http://127.0.0.1:7890",
      allProxy: "socks5://[::1]:7891",
      noProxy: [
        "localhost",
        "127.0.0.1",
        "::1",
        "*.local",
        "10.0.0.0/8",
      ],
    });
  });

  it("returns direct mode when every system proxy is disabled", () => {
    expect(
      parseMacSystemProxy(`
<dictionary> {
  HTTPEnable : 0
  HTTPProxy : 127.0.0.1
  HTTPPort : 7890
  HTTPSEnable : 0
  SOCKSEnable : 0
}
`),
    ).toEqual({
      mode: "direct",
      httpProxy: null,
      httpsProxy: null,
      allProxy: null,
      noProxy: ["localhost", "127.0.0.1", "::1"],
    });
  });

  it("recognizes automatic proxy configuration", () => {
    expect(
      parseMacSystemProxy(`
<dictionary> {
  ProxyAutoConfigEnable : 1
  ProxyAutoConfigURLString : http://proxy.example/proxy.pac
}
`).mode,
    ).toBe("auto");
  });
});

describe("parseResolvedProxy", () => {
  it("uses the first proxy returned by a PAC script", () => {
    expect(parseResolvedProxy("PROXY 127.0.0.1:7890; DIRECT")).toEqual({
      mode: "fixed",
      httpProxy: "http://127.0.0.1:7890",
      httpsProxy: "http://127.0.0.1:7890",
      allProxy: null,
      noProxy: ["localhost", "127.0.0.1", "::1"],
    });
  });
});

describe("applySystemProxyEnvironment", () => {
  it("replaces inherited values with the current fixed proxy", () => {
    expect(
      applySystemProxyEnvironment(
        {
          PATH: "/bin",
          HTTP_PROXY: "http://old:8080",
          HTTPS_PROXY: "http://old:8080",
        },
        {
          mode: "fixed",
          httpProxy: "http://127.0.0.1:7890",
          httpsProxy: "http://127.0.0.1:7890",
          allProxy: null,
          noProxy: ["localhost", "127.0.0.1", "::1"],
        },
        { GROK_DISABLE_AUTOUPDATER: "1" },
      ),
    ).toEqual({
      PATH: "/bin",
      HTTP_PROXY: "http://127.0.0.1:7890",
      http_proxy: "http://127.0.0.1:7890",
      HTTPS_PROXY: "http://127.0.0.1:7890",
      https_proxy: "http://127.0.0.1:7890",
      NO_PROXY: "localhost,127.0.0.1,::1",
      no_proxy: "localhost,127.0.0.1,::1",
      GROK_DISABLE_AUTOUPDATER: "1",
    });
  });

  it("removes inherited proxy values when the current mode is direct", () => {
    const base = {
      PATH: "/bin",
      HTTPS_PROXY: "http://existing:8080",
      http_proxy: "http://existing:8080",
    };

    expect(
      applySystemProxyEnvironment(base, {
        mode: "direct",
        httpProxy: null,
        httpsProxy: null,
        allProxy: null,
        noProxy: ["localhost", "127.0.0.1", "::1"],
      }),
    ).toEqual({
      PATH: "/bin",
      NO_PROXY: "localhost,127.0.0.1,::1",
      no_proxy: "localhost,127.0.0.1,::1",
    });
  });
});
