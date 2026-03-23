function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatLatency(value) {
  if (value == null) return "-";
  return `${(value * 1000).toFixed(1)} ms`;
}

function formatCurrency(value) {
  return `$${(value || 0).toFixed(4)}`;
}

function formatScore(value) {
  if (value == null) return null;
  return value.toFixed(3);
}

function formatTokensPerSecond(tokens, latencySeconds) {
  if (typeof tokens !== "number" || typeof latencySeconds !== "number" || latencySeconds <= 0) {
    return "-";
  }
  return (tokens / latencySeconds).toFixed(1);
}

function HeaderWithHelp({ label, help }) {
  if (!help) return <>{label}</>;
  return (
    <span className="th-label">
      <span className="th-label__text">{label}</span>
      <span className="th-help" data-help={help} aria-label={`${label}: ${help}`}>
        ?
      </span>
    </span>
  );
}

export default function LogsTable({ logs, loading, compact = false }) {
  return (
    <section className="panel">
      {!compact ? (
        <div className="section-heading logs-heading">
          <div>
            <h2>Logs</h2>
            <p>Recent routing outcomes, model usage, and response performance.</p>
          </div>
          {loading ? <span className="status-pill">Loading</span> : null}
        </div>
      ) : (
        <div className="logs-heading--compact">
          {loading ? <span className="status-pill">Loading</span> : null}
        </div>
      )}
      <div className="table-shell">
        <table className="logs-table">
          <thead>
            <tr>
              <th><HeaderWithHelp label="Timestamp" help="When this request completed." /></th>
              <th><HeaderWithHelp label="Model" help="Requested model and route selection." /></th>
              <th><HeaderWithHelp label="Actual Model" help="Provider model that finally served the response." /></th>
              <th>Provider</th>
              <th><HeaderWithHelp label="Latency" help="End-to-end request duration." /></th>
              <th><HeaderWithHelp label="Tokens" help="Total input + output tokens." /></th>
              <th><HeaderWithHelp label="Tok/Sec" help="Throughput: total tokens divided by latency." /></th>
              <th>Cost</th>
              <th>Reason</th>
              <th><HeaderWithHelp label="Fallback" help="Escalated means initial route failed and moved to another model." /></th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan="10" className="empty-state">No logs yet.</td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className={log.fallback_used ? "logs-table__row logs-table__row--fallback" : "logs-table__row"}>
                  <td>{formatDate(log.timestamp)}</td>
                  <td>
                    <div className="model-cell">
                      <span>{log.model_display_name || log.selected_model || "-"}</span>
                      {formatScore(log.routing_score) ? (
                        <span className="model-cell__score">score {formatScore(log.routing_score)}</span>
                      ) : null}
                    </div>
                  </td>
                  <td>{log.actual_model || "-"}</td>
                  <td>
                    <span className={`table-pill table-pill--${log.provider || "unknown"}`}>
                      {log.provider || "-"}
                    </span>
                  </td>
                  <td>{formatLatency(log.latency)}</td>
                  <td>{log.total_tokens ?? "-"}</td>
                  <td>{formatTokensPerSecond(log.total_tokens, log.latency)}</td>
                  <td>{formatCurrency(log.estimated_cost)}</td>
                  <td>{log.routing_reason || "-"}</td>
                  <td>{log.fallback_used ? "Escalated" : "Direct"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
