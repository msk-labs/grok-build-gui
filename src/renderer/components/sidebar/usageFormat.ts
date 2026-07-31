/**
 * Official Grok CLI label: "Weekly limit" / "Monthly limit" / "Usage".
 * Matches pager credit_bar::CreditBalance::usage_label.
 */
import type { TFunction } from "i18next";

export function formatLimitLabel(
  periodType: string | null | undefined,
  t: TFunction<"translation">,
): string {
  if (!periodType) return t("account.usage");
  const key = periodType.toUpperCase();
  if (key.includes("WEEKLY") || key.includes("WEEK")) {
    return t("account.weeklyLimit");
  }
  if (key.includes("MONTHLY") || key.includes("MONTH")) {
    return t("account.monthlyLimit");
  }
  if (key.includes("DAILY") || key.includes("DAY")) {
    return t("account.dailyLimit");
  }
  return t("account.usage");
}

/** Official style: "July 21, 18:03" (local wall clock). */
export function formatNextReset(
  iso: string | null | undefined,
  locale?: string,
): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function accountInitials(name: string | null, email: string | null): string {
  const source = (name || email || "?").trim();
  if (!source) return "?";
  if (source.includes("@")) {
    return source[0]!.toUpperCase();
  }
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function avatarHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}
