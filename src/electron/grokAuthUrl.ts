const LOGIN_URL_PROMPTS = [
  "Open this URL to sign in:",
  "To sign in, open this URL in your browser:",
  "Could not open a browser. Open this URL manually:",
];

/**
 * Grok prints the authorization URL when its own browser launch is rejected.
 * Only accept an HTTPS URL that follows one of the CLI's login prompts.
 */
export function extractGrokLoginUrl(output: string): string | null {
  for (const prompt of LOGIN_URL_PROMPTS) {
    const promptIndex = output.lastIndexOf(prompt);
    if (promptIndex < 0) continue;

    const remainder = output.slice(promptIndex + prompt.length);
    const match = remainder.match(/https:\/\/[^\s<>"']+/);
    if (!match) continue;

    try {
      return new URL(match[0]).toString();
    } catch {
      // Ignore incomplete URLs while the child-process output is streaming.
    }
  }
  return null;
}
