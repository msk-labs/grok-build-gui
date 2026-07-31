import type { PermissionRequest } from "../../electron/preload";
import {
  buildPermissionDisplay,
  isAllowOption,
  permissionOptionLabel,
} from "../lib/permissionDisplay";
import { useTranslation } from "react-i18next";

type Props = {
  request: PermissionRequest | null;
  onRespond: (requestId: string, optionId: string | null) => void;
};

export function PermissionModal({ request, onRespond }: Props) {
  const { t } = useTranslation();
  if (!request) return null;

  const display = buildPermissionDisplay({
    title: request.toolCall.title,
    kind: request.toolCall.kind,
    rawInput: request.toolCall.rawInput,
  }, t);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal modal-permission">
        <div className="modal-permission-header">
          <p className="modal-permission-eyebrow">
            {t("permission.required")}
          </p>
          <h2>{display.heading}</h2>
          {display.purpose ? (
            <p className="modal-desc modal-permission-purpose">
              {display.purpose}
            </p>
          ) : null}
          {display.riskNote ? (
            <p className="modal-permission-risk" role="status">
              {display.riskNote}
            </p>
          ) : null}
        </div>

        {display.details.length > 0 ? (
          <div className="modal-permission-details">
            {display.details.map((d) => (
              <section key={d.label} className="modal-permission-block">
                <h3 className="modal-permission-label">{d.label}</h3>
                <pre
                  className={
                    d.mono
                      ? "modal-tool modal-permission-body"
                      : "modal-permission-body modal-permission-body-plain"
                  }
                >
                  {d.body}
                </pre>
              </section>
            ))}
          </div>
        ) : null}

        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onRespond(request.requestId, null)}
          >
            {t("common.cancel")}
          </button>
          {request.options.map((opt) => {
            const allow = isAllowOption(opt);
            return (
              <button
                key={opt.optionId}
                type="button"
                className={allow ? "btn btn-primary" : "btn btn-ghost"}
                onClick={() => onRespond(request.requestId, opt.optionId)}
              >
                {permissionOptionLabel(opt, t)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
