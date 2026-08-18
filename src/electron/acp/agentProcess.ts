export type GrokSandboxProfile =
  | "off"
  | "workspace"
  | "read-only"
  | "strict";

export const DEFAULT_GROK_SANDBOX_PROFILE: GrokSandboxProfile = "workspace";

/**
 * Build the documented Grok CLI boundary for an ACP stdio runtime.
 *
 * The sandbox profile is deliberately explicit. Grok otherwise defaults to
 * `off`, and a profile is kernel-enforced for the process lifetime, so callers
 * must spawn the process with the workspace as its cwd and must not reuse it
 * for a different workspace/profile pair.
 *
 * Cross-session memory is also explicitly disabled. A GUI "new chat" promises
 * a fresh conversation, so a user-level `GROK_MEMORY` value or config.toml
 * setting must not silently inject context saved by an earlier session.
 */
export function grokAgentStdioArgs(
  sandboxProfile: GrokSandboxProfile,
): string[] {
  return [
    "--no-wait-for-background",
    "--no-memory",
    "--sandbox",
    sandboxProfile,
    "agent",
    "stdio",
  ];
}
