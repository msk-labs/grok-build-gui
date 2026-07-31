/**
 * Keep long-running servers/background jobs alive without making the agent
 * turn wait for their process exit. Supported by the pinned Grok Build 0.2.111
 * top-level CLI and intentionally placed before the `agent` subcommand.
 */
export const GROK_AGENT_STDIO_ARGS = [
  "--no-wait-for-background",
  "agent",
  "stdio",
] as const;
