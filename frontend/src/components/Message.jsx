function formatModelName(model) {
  if (!model || model === "clawhelm-auto" || model === "auto") return null;
  // "openai/gpt-oss-120b:free" → "gpt-oss-120b"
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

  const model = formatModelName(meta.actual_model);
  const provider = meta.provider;
  const latency = formatLatency(meta.latency);
  const fallback = meta.fallback_used;

  const parts = [];
  if (model) parts.push(model);
  if (provider) parts.push(`via ${provider}`);
  if (latency) parts.push(latency);

  if (parts.length === 0) return null;

  return (
    <span className="attribution">
      {parts.join(" · ")}
      {fallback ? <span className="attribution__fallback"> (fallback)</span> : null}
    </span>
  );
}

export default function Message({ role, content, meta }) {
  return (
    <div className={`message message--${role}`}>
      <div className={`message__bubble message__bubble--${role}`}>
        <p className="message__text">{content}</p>
        {role === "assistant" ? <Attribution meta={meta} /> : null}
      </div>
    </div>
  );
}
