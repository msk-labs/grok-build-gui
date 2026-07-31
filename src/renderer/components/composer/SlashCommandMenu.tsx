import type { SlashCommand } from "./slashCommands";
import { shortDescription } from "./slashCommands";
import { useTranslation } from "react-i18next";

export type SlashCommandMenuProps = {
  commands: SlashCommand[];
  activeIndex: number;
  loading?: boolean;
  error?: string | null;
  onHover: (index: number) => void;
  onSelect: (cmd: SlashCommand) => void;
};

export function SlashCommandMenu({
  commands,
  activeIndex,
  loading,
  error,
  onHover,
  onSelect,
}: SlashCommandMenuProps) {
  const { t } = useTranslation();
  const descriptionFor = (cmd: SlashCommand) => {
    if (cmd.source === "builtin" && cmd.name === "browser") {
      return t("composer.browserCommandDesc");
    }
    if (cmd.source === "builtin" && cmd.name === "computer") {
      return t("composer.computerCommandDesc");
    }
    const description = cmd.description ? shortDescription(cmd.description) : "";
    return cmd.inputHint
      ? `${description}${description ? " · " : ""}${cmd.inputHint}`
      : description;
  };
  return (
    <div
      className="composer-slash-menu"
      role="listbox"
      aria-label={t("composer.skillsCommands")}
    >
      <div className="composer-menu-title">{t("composer.skillsCommands")}</div>
      {loading && commands.length === 0 ? (
        <div className="composer-slash-empty">{t("common.loading")}</div>
      ) : null}
      {error && commands.length === 0 ? (
        <div className="composer-slash-empty">{error}</div>
      ) : null}
      {!loading && !error && commands.length === 0 ? (
        <div className="composer-slash-empty">{t("composer.noCommands")}</div>
      ) : null}
      {commands.map((cmd, i) => {
        const description = descriptionFor(cmd);
        return (
          <button
            key={cmd.name}
            type="button"
            role="option"
            aria-selected={i === activeIndex}
            className={`composer-menu-item${
              i === activeIndex ? " active" : ""
            }`}
            onMouseEnter={() => onHover(i)}
            onMouseDown={(e) => {
              // Prevent textarea blur before click applies.
              e.preventDefault();
            }}
            onClick={() => onSelect(cmd)}
          >
            <span className="composer-menu-item-label">
              <span className="composer-slash-name">/{cmd.name}</span>
              {cmd.plugin ? (
                <span className="composer-slash-badge">{cmd.plugin}</span>
              ) : cmd.source && cmd.source !== "bundled" ? (
                <span className="composer-slash-badge">{cmd.source}</span>
              ) : null}
            </span>
            {description ? (
              <span className="composer-menu-item-desc">{description}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
