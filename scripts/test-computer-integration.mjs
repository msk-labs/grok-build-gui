import { execFile, spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { promisify } from "node:util";
import * as acp from "@agentclientprotocol/sdk";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, "..");
const grokManifest = JSON.parse(
  await readFile(
    path.join(projectRoot, "config", "runtime", "grok-build.json"),
    "utf8",
  ),
);
const computerUseManifest = JSON.parse(
  await readFile(
    path.join(projectRoot, "config", "runtime", "open-computer-use.json"),
    "utf8",
  ),
);

if (process.platform !== "win32") {
  throw new Error(
    "The visual desktop fixture currently requires Windows PowerShell and WinForms.",
  );
}

const grokPlatform = grokManifest.platforms[
  `${process.platform}-${process.arch}`
];
if (!grokPlatform) {
  throw new Error(`Grok Build does not support ${process.platform}-${process.arch}.`);
}

const grokPath = path.join(
  projectRoot,
  grokManifest.artifactRelativeRoot,
  grokPlatform.artifactPlatform,
  grokPlatform.executable,
);
const computerUseArch =
  process.arch === "arm64" ? "arm64" : "amd64";
const computerUsePath = path.join(
  projectRoot,
  computerUseManifest.artifactRelativePath,
  "dist",
  "windows",
  computerUseArch,
  "open-computer-use.exe",
);

const ROUTING_INSTRUCTION = `Use the Open Computer Use MCP tools to complete this desktop task.

Follow this operating protocol:
1. Start every turn with list_apps when the target app is unknown, then call get_app_state for the target app before acting.
2. Work from the latest accessibility state. Prefer element_index actions (click, set_value, scroll, or perform_secondary_action) over screenshot coordinates.
3. After each action, inspect its result or call get_app_state again and verify that the expected UI change occurred before continuing.
4. If an element is missing or stale, refresh app state and try a semantically equivalent route. Do not repeat the same failed action more than twice.
5. Use the agent's terminal tool for command execution instead of typing commands into a background terminal window.
6. Continue until the requested end state is visibly verified. If blocked by permissions, an unavailable control, or missing state, explain the exact blocker and the last verified UI state.

Do not claim completion from an action result alone; verify the final screen or value.`;

const COLORS = ["Red", "Blue", "Green", "Yellow"];
const VISUAL_TURN_TIMEOUT_MS = 300_000;

function shuffled(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function fixtureScript() {
  return String.raw`param(
  [Parameter(Mandatory = $true)][string]$Target,
  [Parameter(Mandatory = $true)][string]$Order
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "OCU Visual Fixture"
$form.StartPosition = "CenterScreen"
$form.ClientSize = New-Object System.Drawing.Size(720, 480)
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedSingle
$form.MaximizeBox = $false
$form.TopMost = $true
$form.BackColor = [System.Drawing.Color]::White

$heading = New-Object System.Windows.Forms.Label
$heading.Text = "Match the target swatch to one button"
$heading.Font = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
$heading.AutoSize = $true
$heading.Location = New-Object System.Drawing.Point(135, 24)
$form.Controls.Add($heading)

$targetLabel = New-Object System.Windows.Forms.Label
$targetLabel.Text = "TARGET"
$targetLabel.Font = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
$targetLabel.AutoSize = $true
$targetLabel.Location = New-Object System.Drawing.Point(327, 78)
$form.Controls.Add($targetLabel)

$targetSwatch = New-Object System.Windows.Forms.Panel
$targetSwatch.Name = "TargetSwatch"
$targetSwatch.AccessibleName = "Target swatch"
$targetSwatch.BackColor = [System.Drawing.Color]::FromName($Target)
$targetSwatch.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$targetSwatch.Location = New-Object System.Drawing.Point(280, 108)
$targetSwatch.Size = New-Object System.Drawing.Size(160, 100)
$form.Controls.Add($targetSwatch)

$status = New-Object System.Windows.Forms.Label
$status.Name = "VisualStatus"
$status.AccessibleName = "Visual result"
$status.Text = "WAITING_FOR_VISUAL_ACTION"
$status.Font = New-Object System.Drawing.Font("Consolas", 14, [System.Drawing.FontStyle]::Bold)
$status.AutoSize = $true
$status.Location = New-Object System.Drawing.Point(205, 414)
$form.Controls.Add($status)

$focusGuard = New-Object System.Windows.Forms.TextBox
$focusGuard.AccessibleName = "Fixture focus guard"
$focusGuard.Location = New-Object System.Drawing.Point(-100, -100)
$focusGuard.Size = New-Object System.Drawing.Size(1, 1)
$form.Controls.Add($focusGuard)

$colors = $Order.Split(",")
$letters = @("A", "B", "C", "D")
for ($index = 0; $index -lt $colors.Length; $index += 1) {
  $button = New-Object System.Windows.Forms.Button
  $button.Text = $letters[$index]
  $button.AccessibleName = "Choice " + $letters[$index]
  $button.Tag = $colors[$index]
  $button.BackColor = [System.Drawing.Color]::FromName($colors[$index])
  $button.ForeColor = [System.Drawing.Color]::Black
  $button.UseVisualStyleBackColor = $false
  $button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $button.Font = New-Object System.Drawing.Font("Segoe UI", 20, [System.Drawing.FontStyle]::Bold)
  $button.Location = New-Object System.Drawing.Point((40 + $index * 170), 260)
  $button.Size = New-Object System.Drawing.Size(130, 100)
  $button.Add_Click({
    param($sender, $eventArgs)
    if ($sender.Tag -eq $Target) {
      $status.Text = "VISUAL_ACTION_PASS"
      $status.ForeColor = [System.Drawing.Color]::DarkGreen
    } else {
      $status.Text = "VISUAL_ACTION_FAIL"
      $status.ForeColor = [System.Drawing.Color]::DarkRed
    }
  })
  $button.Add_Enter({
    param($sender, $eventArgs)
    if ($sender.Tag -eq $Target) {
      $status.Text = "VISUAL_ACTION_PASS"
      $status.ForeColor = [System.Drawing.Color]::DarkGreen
    } else {
      $status.Text = "VISUAL_ACTION_FAIL"
      $status.ForeColor = [System.Drawing.Color]::DarkRed
    }
  })
  $form.Controls.Add($button)
}

$form.Add_Shown({
  [void]$focusGuard.Focus()
  $status.Text = "WAITING_FOR_VISUAL_ACTION"
  $status.ForeColor = [System.Drawing.Color]::Black
})

[void]$form.ShowDialog()
`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function callComputerUse(tool, args = {}) {
  const result = await execFileAsync(
    computerUsePath,
    ["call", tool, "--args", JSON.stringify(args)],
    {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return JSON.parse(result.stdout);
}

async function waitForFixture() {
  let lastError = "fixture did not start";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const apps = await callComputerUse("list_apps");
      const appsText =
        apps.content?.find((item) => item.type === "text")?.text ?? "";
      const fixtureLine = appsText
        .split(/\r?\n/)
        .find((line) => line.includes("OCU Visual Fixture"));
      if (!fixtureLine) {
        lastError = `fixture window is absent from list_apps: ${appsText}`;
        await delay(250);
        continue;
      }
      const appName = fixtureLine.split(" -- ", 1)[0]?.trim();
      if (!appName) {
        lastError = `could not parse fixture app from: ${fixtureLine}`;
        await delay(250);
        continue;
      }
      const state = await callComputerUse("get_app_state", {
        app: appName,
        max_tree_depth: 6,
        max_tree_nodes: 100,
        text_limit: "max",
      });
      const text = state.content?.find((item) => item.type === "text")?.text ?? "";
      const image = state.content?.find(
        (item) =>
          item.type === "image" &&
          typeof item.data === "string" &&
          item.data.length > 0,
      );
      if (
        text.includes("OCU Visual Fixture") &&
        text.includes("WAITING_FOR_VISUAL_ACTION") &&
        image
      ) {
        return {
          appName,
          text,
          image: {
            type: "image",
            data: image.data,
            mimeType:
              typeof image.mimeType === "string"
                ? image.mimeType
                : "image/png",
          },
        };
      }
      lastError = image
        ? `unexpected fixture state: ${text.slice(0, 500)}`
        : `fixture state did not include a complete screenshot: ${text.slice(0, 500)}`;
    } catch (error) {
      lastError =
        error instanceof Error
          ? [
              error.message,
              "stdout" in error ? String(error.stdout ?? "") : "",
              "stderr" in error ? String(error.stderr ?? "") : "",
            ]
              .filter(Boolean)
              .join("\n")
          : String(error);
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for the visual fixture: ${lastError}`);
}

async function runPrompt(
  appName,
  targetColor,
  buttonOrder,
  screenshot,
  sessionCwd,
) {
  const updates = [];
  const permissions = [];
  let answer = "";
  let stderr = "";
  const child = spawn(grokPath, ["agent", "stdio"], {
    cwd: sessionCwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      GROK_DISABLE_AUTOUPDATER: "1",
    },
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  const observedToolNames = () =>
    updates
      .map((entry) => entry?.update?.rawInput?.tool_name)
      .filter((name) => typeof name === "string");

  const connection = await acp
    .client({ name: "grok-gui-computer-integration" })
    .onRequest(acp.methods.client.session.requestPermission, async (ctx) => {
      const options = ctx.params.options ?? [];
      const allow =
        options.find((option) => {
          const kind = String(option.kind).toLowerCase();
          return (
            kind.includes("allow") ||
            /^allow\b/i.test(String(option.name))
          );
        }) ?? options[0];
      permissions.push({
        title: ctx.params.toolCall?.title,
        selected: allow?.optionId,
      });
      return allow
        ? { outcome: { outcome: "selected", optionId: allow.optionId } }
        : { outcome: { outcome: "cancelled" } };
    })
    .onRequest(acp.methods.client.fs.readTextFile, async () => ({ content: "" }))
    .onRequest(acp.methods.client.fs.writeTextFile, async () => ({}))
    .onNotification(acp.methods.client.session.update, (ctx) => {
      updates.push(ctx.params);
      const update = ctx.params?.update;
      if (
        update?.sessionUpdate === "agent_message_chunk" &&
        update.content?.type === "text" &&
        typeof update.content.text === "string"
      ) {
        answer += update.content.text;
      }
    })
    .connect(
      acp.ndJsonStream(
        Writable.toWeb(child.stdin),
        Readable.toWeb(child.stdout),
      ),
    );

  let sessionId = null;
  try {
    const initialized = await connection.agent.request(
      acp.methods.agent.initialize,
      {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: {
          name: "grok-gui-computer-integration",
          version: "0.1.0",
        },
      },
    );
    const session = await connection.agent.request(
      acp.methods.agent.session.new,
      {
        cwd: sessionCwd,
        mcpServers: [
          {
            name: "computer-use",
            command: computerUsePath,
            args: ["mcp"],
            env: [
              {
                name: "OPEN_COMPUTER_USE_WINDOWS_ALLOW_UIA_TEXT_FALLBACK",
                value: "1",
              },
            ],
          },
        ],
        _meta: {
          yoloMode: false,
          autoMode: false,
          permission_mode: "ask",
        },
      },
    );
    sessionId = session.sessionId;
    const response = await Promise.race([
      connection.agent.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: [
          {
            type: "text",
            text: `${ROUTING_INSTRUCTION}

The already-running app named ${appName} has a window titled "OCU Visual Fixture". Its accessibility tree names the target swatch and buttons A through D, but intentionally does not reveal their colors. A complete PNG screenshot captured from Open Computer Use get_app_state is attached to this prompt; use that attached screenshot for color reasoning. Refresh app state for current accessibility indexes, determine which button's visible fill color matches the target swatch, click that button, then refresh the app state and verify that VISUAL_ACTION_PASS is visible. Use only Open Computer Use tools.`,
          },
          screenshot,
        ],
      }),
      new Promise((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                `Timed out waiting for the visual computer-use turn.\nTools: ${JSON.stringify(observedToolNames())}\nPartial answer: ${answer}\nStderr: ${stderr}`,
              ),
            ),
          VISUAL_TURN_TIMEOUT_MS,
        );
      }),
    ]);

    const toolNames = observedToolNames();
    return {
      protocolVersion: initialized.protocolVersion,
      sessionId,
      stopReason: response?.stopReason,
      answer,
      toolNames,
      permissions,
      stderr: stderr.trim(),
      targetColor,
      buttonOrder,
    };
  } finally {
    try {
      connection.close();
    } catch {
      // Best-effort integration cleanup.
    }
    if (!child.killed) child.kill();
    if (sessionId) {
      await execFileAsync(
        grokPath,
        ["sessions", "delete", sessionId],
        {
          cwd: projectRoot,
          encoding: "utf8",
          timeout: 30_000,
        },
      ).catch(() => undefined);
    }
  }
}

const scratch = await mkdtemp(
  path.join(tmpdir(), "grok-computer-integration-"),
);
const fixturePath = path.join(scratch, "visual-fixture.ps1");
const targetColor = COLORS[randomInt(COLORS.length)];
const buttonOrder = shuffled(COLORS);
const correctChoice = String.fromCharCode(
  "A".charCodeAt(0) + buttonOrder.indexOf(targetColor),
);
let fixture = null;

try {
  await writeFile(fixturePath, fixtureScript(), "utf8");
  fixture = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-STA",
      "-WindowStyle",
      "Hidden",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      fixturePath,
      "-Target",
      targetColor,
      "-Order",
      buttonOrder.join(","),
    ],
    {
      cwd: scratch,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: false,
    },
  );

  let fixtureError = "";
  fixture.stderr.on("data", (chunk) => {
    fixtureError += chunk.toString("utf8");
  });
  fixture.once("exit", (code) => {
    if (code && !fixture.killed) {
      console.error(
        `[computer-integration] visual fixture exited with ${code}: ${fixtureError}`,
      );
    }
  });

  const fixtureState = await waitForFixture();
  const result = await runPrompt(
    fixtureState.appName,
    targetColor,
    buttonOrder,
    fixtureState.image,
    scratch,
  );
  const finalState = await callComputerUse("get_app_state", {
    app: fixtureState.appName,
    max_tree_depth: 8,
    max_tree_nodes: 150,
    text_limit: "max",
  });
  const finalText =
    finalState.content?.find((item) => item.type === "text")?.text ?? "";

  const usedState = result.toolNames.some((name) =>
    name.endsWith("__get_app_state"),
  );
  const usedClick = result.toolNames.some((name) =>
    name.endsWith("__click"),
  );
  if (!usedState || !usedClick) {
    throw new Error(
      `Agent did not use the required visual interaction tools: ${JSON.stringify(result.toolNames)}`,
    );
  }
  if (!finalText.includes("VISUAL_ACTION_PASS")) {
    throw new Error(
      `Visual action failed (target=${targetColor}, order=${buttonOrder.join(",")}, correct=${correctChoice}).\nPermissions: ${JSON.stringify(result.permissions)}\nTools: ${JSON.stringify(result.toolNames)}\nAgent: ${result.answer}\nFinal state: ${finalText}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        targetColor,
        buttonOrder,
        correctChoice,
        stopReason: result.stopReason,
        answer: result.answer,
        toolNames: result.toolNames,
        finalStatus: "VISUAL_ACTION_PASS",
        stderr: result.stderr,
      },
      null,
      2,
    ),
  );
} finally {
  if (fixture && !fixture.killed) fixture.kill();
  await execFileAsync(
    computerUsePath,
    ["turn-ended", JSON.stringify({ reason: "integration-test-ended" })],
    {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 10_000,
    },
  ).catch(() => undefined);
  await rm(scratch, { recursive: true, force: true });
}
