import { useEffect, useRef, useState } from "react";

function formatContext(len) {
  if (!len) return null;
  if (len >= 1_000_000) return `${(len / 1_000_000).toFixed(1)}M`;
  if (len >= 1000) return `${Math.round(len / 1000)}k`;
  return String(len);
}

function shortenName(name) {
  if (!name) return "";
  let short = name;
  // Strip :free suffix — we show free/paid badge separately
  short = short.replace(/:free$/, "");
  // Capitalize vendor/model format: "nvidia/nemotron" → "Nvidia Nemotron"
  if (short.includes("/")) {
    const parts = short.split("/");
    const vendor = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    let model = parts.slice(1).join("/");
    // Capitalize first letter of model name
    model = model.charAt(0).toUpperCase() + model.slice(1);
    short = `${vendor} ${model}`;
  }
  // Truncate overly long names
  if (short.length > 32) short = short.slice(0, 30) + "…";
  return short;
}

function getSelectedLabel(models, selectedModel) {
  if (selectedModel === "auto") return null; // use icon instead
  const m = models.find((m) => m.id === selectedModel);
  if (!m) return selectedModel;
  return shortenName(m.display_name || m.label || m.id);
}

function WheelIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 190 190" fill="none">
      <circle cx="82" cy="82" r="59" stroke="currentColor" strokeWidth="10"/>
      <path d="M82 43V62" stroke="currentColor" strokeWidth="8" strokeLinecap="round"/>
      <path d="M82 102V121" stroke="currentColor" strokeWidth="8" strokeLinecap="round"/>
      <path d="M43 82H62" stroke="currentColor" strokeWidth="8" strokeLinecap="round"/>
      <path d="M102 82H121" stroke="currentColor" strokeWidth="8" strokeLinecap="round"/>
      <path d="M54.4 54.4L67.8 67.8" stroke="currentColor" strokeWidth="8" strokeLinecap="round"/>
      <path d="M96.2 96.2L109.6 109.6" stroke="currentColor" strokeWidth="8" strokeLinecap="round"/>
      <path d="M109.6 54.4L96.2 67.8" stroke="currentColor" strokeWidth="8" strokeLinecap="round"/>
      <path d="M67.8 96.2L54.4 109.6" stroke="currentColor" strokeWidth="8" strokeLinecap="round"/>
      <circle cx="82" cy="82" r="20" fill="none" stroke="currentColor" strokeWidth="7"/>
      <circle cx="82" cy="82" r="6.5" fill="currentColor"/>
    </svg>
  );
}

export default function ModelSelector({ models, selectedModel, onModelChange, onShowAllModels }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const selectedLabel = getSelectedLabel(models, selectedModel);
  const autoModel = models.find((m) => m.id === "auto");
  const nonAuto = models.filter((m) => m.id !== "auto");
  const topModels = [...nonAuto]
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
    .slice(0, 4);

  return (
    <div className="model-selector" ref={ref}>
      <button
        type="button"
        className={`model-trigger${!selectedLabel ? " model-trigger--icon" : ""}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={selectedLabel || "Auto — best model for your query"}
      >
        {selectedLabel ? (
          <span className="model-trigger__label">{selectedLabel}</span>
        ) : (
          <WheelIcon size={20} />
        )}
        <svg className="model-trigger__chevron" width="10" height="10" viewBox="0 0 12 12" fill="none">
          <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="model-popup">
          <div className="model-popup__grid">
            {/* Auto tile */}
            {autoModel && (
              <button
                type="button"
                className={`mtile${selectedModel === "auto" ? " mtile--selected" : ""} mtile--auto`}
                onClick={() => { onModelChange("auto"); setOpen(false); }}
              >
                <div className="mtile__icon">
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                    <path d="M11 2l2.5 5.5L19 9l-4 4 1 5.5L11 16l-5 2.5 1-5.5-4-4 5.5-1.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div className="mtile__name">Auto</div>
                <div className="mtile__sub">Best pick</div>
              </button>
            )}

            {/* Top model tiles */}
            {topModels.map((m) => {
              const ctx = formatContext(m.context_length);
              return (
                <button
                  type="button"
                  key={m.id}
                  className={`mtile${selectedModel === m.id ? " mtile--selected" : ""}`}
                  onClick={() => { onModelChange(m.id); setOpen(false); }}
                >
                  {m.rank != null && (
                    <span className={`mtile__rank${m.rank <= 3 ? " mtile__rank--top" : ""}`}>#{m.rank}</span>
                  )}
                  <div className="mtile__name">{shortenName(m.display_name || m.label || m.id)}</div>
                  <div className="mtile__tags">
                    <span className={`model-badge${m.is_free ? " model-badge--free" : " model-badge--paid"}`}>
                      {m.is_free ? "Free" : "Paid"}
                    </span>
                    {ctx && <span className="mtile__ctx">{ctx}</span>}
                  </div>
                  {m.modality && m.modality !== "text->text" && (
                    <div className="mtile__modality">{m.modality}</div>
                  )}
                  {m.provider && (
                    <div className="mtile__provider">{m.provider}</div>
                  )}
                </button>
              );
            })}

            {/* Show All tile — always visible */}
            <button
              type="button"
              className="mtile mtile--action"
              onClick={() => { onShowAllModels(); setOpen(false); }}
            >
              <svg className="mtile__action-icon" width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
                <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
                <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
                <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
              <div className="mtile__name">Show All</div>
              <div className="mtile__sub">{nonAuto.length} models</div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
