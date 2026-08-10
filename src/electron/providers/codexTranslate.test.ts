import { describe, expect, it } from "vitest";
import {
  DEFAULT_INSTRUCTIONS,
  extractRateLimitWindows,
  formatWindowLabel,
  translateResponsesRequest,
} from "./codexTranslate";

describe("translateResponsesRequest", () => {
  it("forces the settings the ChatGPT backend requires", () => {
    expect(
      translateResponsesRequest({
        model: "gpt-5.3-codex",
        input: [],
        store: true,
        stream: false,
      }),
    ).toMatchObject({
      model: "gpt-5.3-codex",
      store: false,
      stream: true,
      instructions: DEFAULT_INSTRUCTIONS,
    });
  });

  it("keeps caller instructions", () => {
    expect(
      translateResponsesRequest({ instructions: "Be terse." }).instructions,
    ).toBe("Be terse.");
    expect(
      translateResponsesRequest({ instructions: "   " }).instructions,
    ).toBe(DEFAULT_INSTRUCTIONS);
  });

  it("drops fields that need server-side storage", () => {
    const out = translateResponsesRequest({
      previous_response_id: "resp_1",
      service_tier: "auto",
    });
    expect(out).not.toHaveProperty("previous_response_id");
    expect(out).not.toHaveProperty("service_tier");
  });

  it("requests encrypted reasoning when reasoning is on", () => {
    expect(
      translateResponsesRequest({ reasoning: { effort: "high" } }).include,
    ).toEqual(["reasoning.encrypted_content"]);
  });

  it("does not duplicate an include the caller already set", () => {
    expect(
      translateResponsesRequest({
        reasoning: { effort: "low" },
        include: ["reasoning.encrypted_content"],
      }).include,
    ).toEqual(["reasoning.encrypted_content"]);
  });

  it("leaves include untouched without reasoning", () => {
    expect(translateResponsesRequest({ input: [] })).not.toHaveProperty(
      "include",
    );
  });

  it("does not mutate the caller's body", () => {
    const original = { store: true, stream: false };
    translateResponsesRequest(original);
    expect(original).toEqual({ store: true, stream: false });
  });
});

describe("formatWindowLabel", () => {
  it("names the common subscription windows", () => {
    expect(formatWindowLabel(300)).toBe("5h window");
    expect(formatWindowLabel(10_080)).toBe("Weekly");
    expect(formatWindowLabel(1440)).toBe("Daily");
    expect(formatWindowLabel(45)).toBe("45m window");
    expect(formatWindowLabel(null)).toBeNull();
    expect(formatWindowLabel(0)).toBeNull();
  });
});

describe("extractRateLimitWindows", () => {
  const now = Date.parse("2026-08-05T00:00:00.000Z");

  function headersOf(map: Record<string, string>) {
    return (name: string) => map[name] ?? null;
  }

  it("reads both plan windows", () => {
    expect(
      extractRateLimitWindows(
        headersOf({
          "x-codex-primary-used-percent": "42.5",
          "x-codex-primary-window-minutes": "300",
          "x-codex-primary-reset-after-seconds": "600",
          "x-codex-secondary-used-percent": "8",
          "x-codex-secondary-window-minutes": "10080",
          "x-codex-secondary-reset-after-seconds": "86400",
        }),
        now,
      ),
    ).toEqual([
      {
        id: "primary",
        label: "5h window",
        usedPercent: 42.5,
        resetsAt: "2026-08-05T00:10:00.000Z",
      },
      {
        id: "secondary",
        label: "Weekly",
        usedPercent: 8,
        resetsAt: "2026-08-06T00:00:00.000Z",
      },
    ]);
  });

  it("clamps out-of-range percentages", () => {
    expect(
      extractRateLimitWindows(
        headersOf({ "x-codex-primary-used-percent": "132" }),
        now,
      )[0],
    ).toMatchObject({ usedPercent: 100, label: "Current window" });
  });

  it("returns nothing when the upstream sends no limit headers", () => {
    expect(extractRateLimitWindows(headersOf({}), now)).toEqual([]);
  });

  it("skips unparseable values rather than inventing numbers", () => {
    expect(
      extractRateLimitWindows(
        headersOf({
          "x-codex-primary-used-percent": "n/a",
          "x-codex-primary-window-minutes": "300",
        }),
        now,
      )[0],
    ).toMatchObject({ usedPercent: null, resetsAt: null, label: "5h window" });
  });
});
