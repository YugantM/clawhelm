import { useId, useState } from "react";

function toTitleCase(value) {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function inferProviderFromModel(modelId) {
  if (typeof modelId !== "string" || !modelId.trim()) return "Unknown";
  if (modelId.startsWith("openrouter/") || modelId.endsWith(":free")) return "openrouter";
  return "openai";
}

function getShortModelName(insight) {
  const modelValue = insight?.actual_model || insight?.fallback_to_model || insight?.selected_model || insight?.model_display_name || "";
  if (!modelValue) {
    return "Model pending";
  }
  if (modelValue === "clawhelm-auto" || modelValue === "auto") {
    return "Auto selection";
  }
  const actualValue = modelValue.includes("->") ? modelValue.split("->").pop().trim() : modelValue;
  const [namespace, slug] = actualValue.split("/");

  if (namespace && slug) {
    const slugRoot = slug.split(/[:_-]/)[0];
    if (slugRoot.toLowerCase() === namespace.toLowerCase()) {
      return toTitleCase(namespace);
    }
    return toTitleCase(slug.split(":")[0]);
  }

  return toTitleCase(actualValue.split(":")[0]);
}

function getRoutingMode(insight) {
  return insight?.selected_model === "clawhelm-auto" || insight?.selected_model === "auto" ? "auto" : "manual";
}

function formatLatency(insight) {
  if (typeof insight?.latency !== "number") return null;
  if (insight.latency < 1) {
    return `${Math.round(insight.latency * 1000)} ms`;
  }
  return `${insight.latency.toFixed(2)} s`;
}

export default function MessageMetaTooltip({ insight }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rawModelPath = insight?.actual_model || insight?.fallback_to_model || insight?.selected_model || insight?.model_display_name || "";
  const fullModelPath = rawModelPath === "clawhelm-auto" || rawModelPath === "auto" ? "Auto selection (resolving)" : rawModelPath || "Model pending";
  const latency = formatLatency(insight);
  const fallbackUsed = Boolean(insight?.fallback_used);
  const fallbackFrom = insight?.fallback_from_model || null;
  const fallbackTo = insight?.fallback_to_model || insight?.actual_model || null;
  const provider = insight?.provider || inferProviderFromModel(rawModelPath);

  return (
    <div
      className={`message-meta ${open ? "message-meta--open" : ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="message-meta__label">Powered by {getShortModelName(insight)}</span>
      <button
        type="button"
        className="message-meta__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        ?
      </button>
      <div className="message-meta__panel" id={panelId} role="tooltip">
        <div>
          <span>Model</span>
          <strong>{fullModelPath}</strong>
        </div>
        <div>
          <span>Provider</span>
          <strong>{provider}</strong>
        </div>
        <div>
          <span>Routing</span>
          <strong>{getRoutingMode(insight)}</strong>
        </div>
        <div>
          <span>Fallback</span>
          <strong className={fallbackUsed ? "message-meta__fallback--active" : "message-meta__fallback--none"}>
            {fallbackUsed ? "Used" : "Not used"}
          </strong>
        </div>
        {fallbackUsed && (fallbackFrom || fallbackTo) ? (
          <div>
            <span>Fallback Model</span>
            <strong>{fallbackFrom && fallbackTo ? `${fallbackFrom} -> ${fallbackTo}` : fallbackTo || fallbackFrom}</strong>
          </div>
        ) : null}
        {latency ? (
          <div>
            <span>Latency</span>
            <strong>{latency}</strong>
          </div>
        ) : null}
      </div>
    </div>
  );
}
