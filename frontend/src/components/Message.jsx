import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

function formatModelName(model) {
  if (!model || model === "clawhelm-auto" || model === "auto") return null;
  const parts = model.split("/");
  const slug = parts.length > 1 ? parts[parts.length - 1] : model;
  return slug.split(":")[0];
}

function formatLatency(seconds) {
  if (typeof seconds !== "number") return null;
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  return `${seconds.toFixed(1)}s`;
}

function Attribution({ meta }) {
  if (!meta) return null;

  const model = meta.display_name || formatModelName(meta.actual_model);
  const provider = meta.provider;
  const latency = formatLatency(meta.latency);
  const fallback = meta.fallback_used;

  const speedRatio =
    meta.runner_up_avg_latency && meta.latency && meta.latency > 0
      ? meta.runner_up_avg_latency / meta.latency
      : null;

  const parts = [];
  if (model) parts.push(model);
  if (provider) parts.push(`via ${provider}`);
  if (latency) parts.push(latency);

  if (parts.length === 0) return null;

  return (
    <span className="attribution">
      {parts.join(" · ")}
      {fallback ? <span className="attribution__fallback"> (fallback)</span> : null}
      {speedRatio !== null && speedRatio > 1.1 ? (
        <span className="attribution__speed-badge">⚡ {speedRatio.toFixed(1)}x faster</span>
      ) : null}
    </span>
  );
}

function CopyButton({ code }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
  };
  return (
    <button type="button" className="code-copy-btn" onClick={handleCopy} title="Copy code">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
      </svg>
    </button>
  );
}

const markdownComponents = {
  code({ node, inline, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || "");
    const code = String(children).replace(/\n$/, "");
    if (!inline && match) {
      return (
        <div className="md-code-block">
          <div className="md-code-header">
            <span className="md-code-lang">{match[1]}</span>
            <CopyButton code={code} />
          </div>
          <SyntaxHighlighter
            style={oneDark}
            language={match[1]}
            PreTag="div"
            customStyle={{ margin: 0, borderRadius: "0 0 8px 8px", fontSize: "0.82rem" }}
            {...props}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      );
    }
    if (!inline && code.includes("\n")) {
      return (
        <div className="md-code-block">
          <div className="md-code-header">
            <span className="md-code-lang">code</span>
            <CopyButton code={code} />
          </div>
          <SyntaxHighlighter
            style={oneDark}
            language="text"
            PreTag="div"
            customStyle={{ margin: 0, borderRadius: "0 0 8px 8px", fontSize: "0.82rem" }}
            {...props}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      );
    }
    return <code className="md-inline-code" {...props}>{children}</code>;
  },
  table({ children }) {
    return <div className="md-table-wrap"><table className="md-table">{children}</table></div>;
  },
};

export default function Message({ role, content, meta }) {
  if (role === "system") {
    return (
      <div className="message message--system">
        <div className="message__system-notice">{content}</div>
      </div>
    );
  }

  return (
    <div className={`message message--${role}`}>
      <div className={`message__bubble message__bubble--${role}`}>
        {role === "assistant" ? (
          <div className="message__markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {content}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="message__text">{content}</p>
        )}
        {role === "assistant" ? <Attribution meta={meta} /> : null}
      </div>
    </div>
  );
}
