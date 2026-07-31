import { panelToolIcon } from "./panelIcons";
import { PANEL_TOOLS, SIDE_TASK_ACTION } from "./tools";
import { toolTranslationKeys } from "./tools";
import type { SplitTool } from "./types";
import { useTranslation } from "react-i18next";

type Props = {
  onOpenTool: (tool: SplitTool) => void;
  sideTaskEnabled?: boolean;
};

/** Empty-state tool picker (right panel entry). */
export function SplitHome({ onOpenTool, sideTaskEnabled }: Props) {
  const { t } = useTranslation();

  return (
    <div className="split-panel-home" aria-label={t("tools.tools")}>
      {PANEL_TOOLS.map((tool) => {
        const keys = toolTranslationKeys(tool.id);
        return (
          <button
            key={tool.id}
            type="button"
            className="split-panel-home-btn"
            onClick={() => onOpenTool(tool.id)}
            title={keys.description ? t(keys.description) : undefined}
          >
            <span className="split-panel-home-btn-icon">
              {panelToolIcon(tool.id, 18)}
            </span>
            <span className="split-panel-home-btn-label">{t(keys.label)}</span>
          </button>
        );
      })}
      {sideTaskEnabled ? (
        <button
          type="button"
          className="split-panel-home-btn"
          onClick={() => onOpenTool(SIDE_TASK_ACTION.id)}
          title={t("tools.sideTaskDesc")}
        >
          <span className="split-panel-home-btn-icon">
            {panelToolIcon(SIDE_TASK_ACTION.id, 18)}
          </span>
          <span className="split-panel-home-btn-label">
            {t("tools.sideTask")}
          </span>
        </button>
      ) : null}
    </div>
  );
}
