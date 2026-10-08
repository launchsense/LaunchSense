import { useState } from "react";

interface CodeBlockProps {
  code: string;
  label?: string;
  className?: string;
}

export function CodeBlock({ code, label = "code", className = "" }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard
        .writeText(code)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => {});
    }
  };

  return (
    <div className={`code-block-wrapper ${className}`.trim()}>
      <div className="code-block-bar">
        <span className="code-block-label">{label}</span>
        <button
          type="button"
          className="ghost code-copy-btn"
          onClick={handleCopy}
          aria-label={`Copy ${label}`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="install-command">
        <code>{code}</code>
      </pre>
    </div>
  );
}
