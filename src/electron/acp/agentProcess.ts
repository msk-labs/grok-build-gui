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
 */
export function grokAgentStdioArgs(
  sandboxProfile: GrokSandboxProfile,
): string[] {
  return [
    "--no-wait-for-background",
    "--sandbox",
    sandboxProfile,
    "agent",
    "stdio",
  ];
}
