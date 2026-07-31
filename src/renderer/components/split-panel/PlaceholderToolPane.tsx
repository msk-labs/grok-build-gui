type Props = {
  title: string;
  description: string;
};

/** Minimal body for split-panel tools that do not have a full body yet. */
export function PlaceholderToolPane({ title, description }: Props) {
  return (
    <div className="placeholder-tool-pane" aria-label={title}>
      <div className="placeholder-tool-pane-body">
        <p className="placeholder-tool-pane-desc">{description}</p>
      </div>
    </div>
  );
}
