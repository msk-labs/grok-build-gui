import { useTranslation } from "react-i18next";

/**
 * Compact waveform next to the mic (Codex-like).
 * Does not replace the footer or change composer size.
 */
export function VoiceWaveInline({
  levels,
  active,
}: {
  levels: number[];
  active?: boolean;
}) {
  const { t } = useTranslation();
  if (!active) return null;
  return (
    <div
      className="voice-wave-inline"
      aria-hidden
      title={t("composer.recording")}
    >
      {levels.map((h, i) => (
        <span
          key={i}
          className="voice-wave-inline-bar"
          style={{ transform: `scaleY(${Math.max(0.15, h)})` }}
        />
      ))}
    </div>
  );
}
