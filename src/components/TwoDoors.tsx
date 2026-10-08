interface TwoDoorsProps {
  small?: boolean;
}

export function TwoDoors({ small = false }: TwoDoorsProps) {
  return (
    <figure
      className={`diagram-container ${small ? "diagram-small" : ""}`.trim()}
      aria-label="Local reads files, online serves rules"
    >
      <div className="diagram-grid">
        <div className="door-card door-local">
          <div className="door-header">
            <svg
              className="door-glyph door-glyph-local"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
            </svg>
            <h3 className="door-title">Local reads files</h3>
          </div>
          <ul className="door-list">
            <li>working tree</li>
            <li>
              <code>.ls/policy.yaml</code>
            </li>
            <li>nothing uploaded</li>
          </ul>
        </div>

        <div className="door-center-pill">
          <span className="pill-arrow pill-arrow-left" aria-hidden="true">
            &rarr;
          </span>
          <span className="pill-icon" aria-hidden="true">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
          </span>
          <span className="pill-arrow pill-arrow-right" aria-hidden="true">
            &larr;
          </span>
          <span className="pill-text">Your tool reads right, audits left</span>
        </div>

        <div className="door-card door-online">
          <div className="door-header">
            <svg
              className="door-glyph door-glyph-online"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
            </svg>
            <h3 className="door-title">Online serves rules</h3>
          </div>
          <ul className="door-list">
            <li>skill</li>
            <li>rules</li>
            <li>checklist</li>
          </ul>
        </div>
      </div>
      <figcaption className="diagram-caption">Nothing is uploaded.</figcaption>
    </figure>
  );
}
