/** GUI-owned `/computer` routing for the optional Open Computer Use MCP. */

export type ComputerSlashAction =
  | { kind: "prompt"; agentText: string }
  | { kind: "none" };

const ROUTING_INSTRUCTION = `Use the Open Computer Use MCP tools to complete this desktop task.

Follow this operating protocol:
1. Start every turn with list_apps when the target app is unknown, then call get_app_state for the target app before acting.
2. Work from the latest accessibility state. Prefer element_index actions (click, set_value, scroll, or perform_secondary_action) over screenshot coordinates.
3. After each action, inspect its result or call get_app_state again and verify that the expected UI change occurred before continuing.
4. If an element is missing or stale, refresh app state and try a semantically equivalent route. Do not repeat the same failed action more than twice.
5. Use the agent's terminal tool for command execution instead of typing commands into a background terminal window.
6. Continue until the requested end state is visibly verified. If blocked by permissions, an unavailable control, or missing state, explain the exact blocker and the last verified UI state.

Do not claim completion from an action result alone; verify the final screen or value.`;

export function parseComputerSlash(raw: string): ComputerSlashAction {
  const text = raw.trim();
  if (!text.startsWith("/computer")) return { kind: "none" };
  if (
    text !== "/computer" &&
    !text.startsWith("/computer ") &&
    !text.startsWith("/computer\n")
  ) {
    return { kind: "none" };
  }

  const task = text.slice("/computer".length).trim();
  return {
    kind: "prompt",
    agentText: task
      ? `${ROUTING_INSTRUCTION}\n\n${task}`
      : `${ROUTING_INSTRUCTION}\n\nList the available applications, then ask which application I want to control.`,
  };
}

export const COMPUTER_SLASH_COMMAND = {
  name: "computer",
  description:
    "Control native desktop apps with Open Computer Use. Example: /computer open TextEdit.",
  source: "builtin",
  plugin: null as string | null,
};
