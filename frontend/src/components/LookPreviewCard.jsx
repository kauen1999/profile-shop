// Generic visual container for a live text preview. Zero domain knowledge —
// just renders whatever text/lines it's given, updating live as the prop
// changes (no internal state, no fetching, no decision-making). Accepts
// either a single `text` string (split on '\n') or an explicit `lines`
// array — callers pass whichever is more convenient to build.
export function LookPreviewCard({ text, lines, title }) {
  const resolvedLines = lines || (text ? text.split('\n') : []);

  return (
    <div className="look-preview-card">
      {title && <h2 className="look-preview-title">{title}</h2>}
      <pre className="look-preview-body">
        {resolvedLines.map((line, index) => (
          // Blank lines are meaningful here (paragraph breaks) — keep them
          // as empty text nodes rather than collapsing/skipping them.
          <span className="look-preview-line" key={index}>
            {line}
            {'\n'}
          </span>
        ))}
      </pre>
    </div>
  );
}
