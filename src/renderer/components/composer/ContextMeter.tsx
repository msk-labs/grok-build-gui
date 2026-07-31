import type { MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { ContextUsage, ModelState } from "../../../electron/preload";
import {
  contextBreakdown,
  contextMeter,
  formatTokens,
} from "../../lib/contextWindow";
import type { ComposerMenu } from "./ComposerMenus";

export type ContextMeterProps = {
  menu: ComposerMenu;
  toggleMenu: (which: NonNullable<ComposerMenu>, e: ReactMouseEvent) => void;
  disabled: boolean;
  /** Focused session's usage; null before its first turn reports anything. */
  usage: ContextUsage | null;
  models: ModelState;
};

const RING_RADIUS = 6;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Donut that fills clockwise from 12 o'clock. */
function ContextRing({ percent }: { percent: number }) {
  const filled =
    (Math.max(0, Math.min(100, percent)) / 100) * RING_CIRCUMFERENCE;
  return (
    <svg
      className="context-ring"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden
    >
      <circle className="context-ring-track" cx="8" cy="8" r={RING_RADIUS} />
      <circle
        className="context-ring-fill"
        cx="8"
        cy="8"
        r={RING_RADIUS}
        strokeDasharray={`${filled} ${RING_CIRCUMFERENCE}`}
        transform="rotate(-90 8 8)"
      />
    </svg>
  );
}

/** Round for display, but never show a non-empty context as 0%. */
function displayPercent(percent: number): string {
  if (percent > 0 && percent < 1) return "<1";
  return String(Math.round(percent));
}

export function ContextMeter({
  menu,
  toggleMenu,
  disabled,
  usage,
  models,
}: ContextMeterProps) {
  const { t } = useTranslation();
  const open = menu === "context";
  const meter = contextMeter(usage, models);
  const breakdown = contextBreakdown(usage);

  const level = meter?.level ?? "empty";
  const percentLabel = meter ? `${displayPercent(meter.percent)}%` : "—";
  const chipTitle = meter
    ? t("composer.contextUsedOf", {
        used: formatTokens(meter.usedTokens),
        size: formatTokens(meter.sizeTokens),
        percent: displayPercent(meter.percent),
      })
    : t("composer.contextEmpty");

  /** Segment widths are percentages of the whole window, so they line up. */
  function segmentWidth(tokens: number): string {
    if (!meter || meter.sizeTokens <= 0) return "0%";
    return `${Math.min(100, (tokens / meter.sizeTokens) * 100)}%`;
  }

  return (
    <div className="composer-chip-wrap composer-chip-wrap-end">
      <button
        type="button"
        className={`composer-chip composer-context-chip level-${level}${
          open ? " open" : ""
        }`}
        onClick={(e) => toggleMenu("context", e)}
        disabled={disabled}
        title={chipTitle}
        aria-label={chipTitle}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ContextRing percent={meter?.percent ?? 0} />
      </button>
      {open ? (
        <div
          className={`composer-menu composer-menu-context level-${level}`}
          role="menu"
          aria-label={t("composer.contextWindow")}
        >
          <div className="context-panel-title">
            {t("composer.contextWindow")}
          </div>
          {meter ? (
            <>
              <div className="context-panel-head">
                <span className="context-panel-total">
                  {formatTokens(meter.usedTokens)}
                  <span className="context-panel-size">
                    {" / "}
                    {formatTokens(meter.sizeTokens)}
                  </span>
                </span>
                <span className={`context-panel-pct level-${meter.level}`}>
                  {percentLabel}
                </span>
              </div>
              <div
                className={`context-panel-bar level-${meter.level}`}
                role="img"
                aria-label={chipTitle}
              >
                {breakdown ? (
                  <>
                    <span
                      className="context-seg seg-cached"
                      style={{ width: segmentWidth(breakdown.cachedTokens) }}
                    />
                    <span
                      className="context-seg seg-input"
                      style={{
                        width: segmentWidth(breakdown.freshInputTokens),
                      }}
                    />
                    <span
                      className="context-seg seg-output"
                      style={{ width: segmentWidth(breakdown.outputTokens) }}
                    />
                  </>
                ) : (
                  <span
                    className="context-seg seg-used"
                    style={{ width: segmentWidth(meter.usedTokens) }}
                  />
                )}
              </div>
              <ul className="context-legend">
                {/* Without a turn breakdown the only slice is the total, which
                    the headline already states — just show what is left. */}
                {breakdown ? (
                  <>
                    <li className="context-legend-row">
                      <span className="context-dot seg-cached" />
                      <span className="context-legend-label">
                        {t("composer.contextCached")}
                      </span>
                      <span className="context-legend-value">
                        {formatTokens(breakdown.cachedTokens)}
                      </span>
                    </li>
                    <li className="context-legend-row">
                      <span className="context-dot seg-input" />
                      <span className="context-legend-label">
                        {t("composer.contextFreshInput")}
                      </span>
                      <span className="context-legend-value">
                        {formatTokens(breakdown.freshInputTokens)}
                      </span>
                    </li>
                    <li className="context-legend-row">
                      <span className="context-dot seg-output" />
                      <span className="context-legend-label">
                        {t("composer.contextOutput")}
                      </span>
                      <span className="context-legend-value">
                        {breakdown.reasoningTokens > 0 ? (
                          <span className="context-legend-note">
                            {t("composer.contextThinkingOf", {
                              tokens: formatTokens(breakdown.reasoningTokens),
                            })}
                          </span>
                        ) : null}
                        {formatTokens(breakdown.outputTokens)}
                      </span>
                    </li>
                  </>
                ) : null}
                <li className="context-legend-row">
                  <span className="context-dot seg-free" />
                  <span className="context-legend-label">
                    {t("composer.contextFree")}
                  </span>
                  <span className="context-legend-value">
                    {formatTokens(meter.freeTokens)}
                  </span>
                </li>
              </ul>
              {usage?.session ? (
                <div className="context-session-line">
                  {t("composer.contextSessionSummary", {
                    tokens: formatTokens(usage.session.totalTokens),
                    turns: usage.session.numTurns,
                    calls: usage.session.modelCalls,
                  })}
                </div>
              ) : null}
            </>
          ) : (
            <div className="context-panel-empty">
              {t("composer.contextEmpty")}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
