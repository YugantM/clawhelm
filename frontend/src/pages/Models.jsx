import { useMemo, useState } from "react";

function formatContext(len) {
  if (!len) return null;
  if (len >= 1_000_000) return `${(len / 1_000_000).toFixed(1)}M`;
  if (len >= 1000) return `${Math.round(len / 1000)}k`;
  return String(len);
}

function shortenName(name) {
  if (!name) return "";
  let short = name.replace(/:free$/, "");
  if (short.includes("/")) {
    const parts = short.split("/");
    const vendor = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    let model = parts.slice(1).join("/");
    model = model.charAt(0).toUpperCase() + model.slice(1);
    short = `${vendor} ${model}`;
  }
  if (short.length > 36) short = short.slice(0, 34) + "…";
  return short;
}

const DIMENSIONS = [
  { key: "overall", label: "Overall", rankField: "rank" },
  { key: "speed", label: "Speed", rankField: "rank_by_speed" },
  { key: "quality", label: "Quality", rankField: "rank_by_quality" },
  { key: "cost", label: "Cost", rankField: "rank_by_cost" },
];

export default function Models({ models, selectedModel, onModelChange, onClose }) {
  const [filter, setFilter] = useState("all");
  const [modalityFilter, setModalityFilter] = useState("all");
  const [dimension, setDimension] = useState("overall");

  const nonAuto = models.filter((m) => m.id !== "auto");

  const modalities = useMemo(
    () => [...new Set(nonAuto.map((m) => m.modality).filter(Boolean))].sort(),
    [nonAuto],
  );

  const dimInfo = DIMENSIONS.find((d) => d.key === dimension) || DIMENSIONS[0];

  const filtered = useMemo(() => {
    let list = nonAuto;
    if (filter === "free") list = list.filter((m) => m.is_free);
    if (filter === "paid") list = list.filter((m) => !m.is_free);
    if (modalityFilter !== "all") list = list.filter((m) => m.modality === modalityFilter);
    return [...list].sort((a, b) => (a[dimInfo.rankField] ?? 999) - (b[dimInfo.rankField] ?? 999));
  }, [nonAuto, filter, modalityFilter, dimInfo]);

  return (
    <div className="models-page">
      <div className="models-page__header">
        <div>
          <h2 className="models-page__title">All Models</h2>
          <p className="models-page__desc">
            Models are ranked by quality, speed, and cost. Auto mode picks the best model for each query.
          </p>
        </div>
        <button type="button" className="models-page__close" onClick={onClose} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div className="models-filters">
        <div className="models-filters__group">
          {["all", "free", "paid"].map((f) => (
            <button
              key={f}
              type="button"
              className={`seg-btn${filter === f ? " seg-btn--active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "free" ? "Free" : "Paid"}
            </button>
          ))}
        </div>
        {modalities.length > 1 && (
          <select
            className="models-filters__modality"
            value={modalityFilter}
            onChange={(e) => setModalityFilter(e.target.value)}
          >
            <option value="all">All modalities</option>
            {modalities.map((mod) => (
              <option key={mod} value={mod}>{mod}</option>
            ))}
          </select>
        )}
        <span className="models-filters__count">{filtered.length} model{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      <div className="models-dimensions">
        {DIMENSIONS.map((d) => (
          <button
            key={d.key}
            type="button"
            className={`dim-tab${dimension === d.key ? " dim-tab--active" : ""}`}
            onClick={() => setDimension(d.key)}
          >
            {d.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="models-empty">No models match your filters</div>
      ) : (
        <div className="models-grid">
          {filtered.map((m) => {
            const rank = m[dimInfo.rankField];
            const ctx = formatContext(m.context_length);
            const maxTok = formatContext(m.max_completion_tokens);
            return (
              <button
                key={m.id}
                type="button"
                className={`model-card${selectedModel === m.id ? " model-card--selected" : ""}`}
                onClick={() => { onModelChange(m.id); onClose(); }}
              >
                <div className="model-card__top">
                  <div className="model-card__name">{shortenName(m.display_name || m.label || m.id)}</div>
                  {rank != null && (
                    <span className={`rank-badge${rank <= 3 ? " rank-badge--top" : ""}`}>
                      #{rank}
                    </span>
                  )}
                </div>

                {m.description && (
                  <p className="model-card__desc">{m.description}</p>
                )}

                <div className="model-card__chips">
                  <span className={`model-badge${m.is_free ? " model-badge--free" : " model-badge--paid"}`}>
                    {m.is_free ? "Free" : "Paid"}
                  </span>
                  {m.provider && (
                    <span className="model-card__chip">{m.provider}</span>
                  )}
                  {m.modality && m.modality !== "text->text" && (
                    <span className="model-card__chip">{m.modality}</span>
                  )}
                </div>

                <div className="model-card__stats">
                  {ctx && (
                    <div className="model-card__stat">
                      <span className="model-card__stat-label">Context</span>
                      <span className="model-card__stat-value">{ctx}</span>
                    </div>
                  )}
                  {maxTok && (
                    <div className="model-card__stat">
                      <span className="model-card__stat-label">Max output</span>
                      <span className="model-card__stat-value">{maxTok}</span>
                    </div>
                  )}
                  {m.prompt_cost_per_m != null && (
                    <div className="model-card__stat">
                      <span className="model-card__stat-label">Input</span>
                      <span className="model-card__stat-value">${m.prompt_cost_per_m}/M</span>
                    </div>
                  )}
                  {m.completion_cost_per_m != null && (
                    <div className="model-card__stat">
                      <span className="model-card__stat-label">Output</span>
                      <span className="model-card__stat-value">${m.completion_cost_per_m}/M</span>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
