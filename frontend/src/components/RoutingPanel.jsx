function formatLatency(value) {
  if (value == null) return "-";
  return `${(value * 1000).toFixed(1)} ms`;
}

function formatCurrency(value) {
  return `$${(value || 0).toFixed(4)}`;
}

function formatScore(value) {
  if (value == null) return "-";
  return value.toFixed(3);
}

function InsightRow({ label, value }) {
  return (
    <div className="insight-row">
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

export default function RoutingPanel({ insight, collapsed, onToggle }) {
  return (
    <aside className={`routing-panel panel ${collapsed ? "routing-panel--collapsed" : ""}`}>
      <div className="section-heading">
        <div>
          <h2>Routing Intelligence</h2>
          <p>Selected route versus actual answering model.</p>
        </div>
        <button
          type="button"
          className="panel-toggle"
          onClick={onToggle}
        >
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </div>

      {collapsed ? (
        <div className="routing-collapsed">
          <span className="routing-collapsed__label">Panel collapsed</span>
          <strong>{insight?.model_display_name || insight?.actual_model || "No active route"}</strong>
        </div>
      ) : !insight ? (
        <div className="routing-empty">
          <h3>No routing record selected</h3>
          <p>Send a chat message or click an assistant response to inspect the route.</p>
        </div>
      ) : (
        <div className="routing-card">
          <div className="routing-card__hero">
            <span className="routing-card__provider">{insight.provider || "unknown"}</span>
            <strong>{insight.model_display_name || insight.actual_model || insight.selected_model}</strong>
            <p>{insight.routing_reason || "No routing reason recorded"}</p>
          </div>
          <div className="routing-grid">
            <InsightRow label="Selected model" value={insight.selected_model} />
            <InsightRow label="Actual model" value={insight.actual_model} />
            <InsightRow label="Source" value={insight.request_source} />
            <InsightRow label="Provider" value={insight.provider} />
            <InsightRow label="Latency" value={formatLatency(insight.latency)} />
            <InsightRow label="Score" value={formatScore(insight.routing_score)} />
            <InsightRow label="Tokens" value={insight.total_tokens ?? "-"} />
            <InsightRow label="Cost" value={formatCurrency(insight.estimated_cost)} />
            <InsightRow label="Reason" value={insight.routing_reason} />
            <InsightRow label="Fallback" value={insight.fallback_used ? "Escalated" : "Direct"} />
          </div>
        </div>
      )}
    </aside>
  );
}
