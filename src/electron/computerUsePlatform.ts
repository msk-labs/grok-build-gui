export function computerUsePermissionsRequired(
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "darwin";
}

export function computerUseMcpEnvironment(
  platform: NodeJS.Platform = process.platform,
): Array<{ name: string; value: string }> {
  if (platform !== "win32") return [];
  return [
    {
      name: "OPEN_COMPUTER_USE_WINDOWS_ALLOW_UIA_TEXT_FALLBACK",
      value: "1",
    },
  ];
}
