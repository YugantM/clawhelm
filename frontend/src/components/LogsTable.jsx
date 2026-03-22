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

export default function LogsTable({ logs, loading }) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Request Ledger</h2>
          <p>Latest proxy activity with selected versus actual model attribution.</p>
        </div>
        {loading ? <span className="status-pill">Loading</span> : null}
      </div>
      <div className="table-shell">
        <table className="logs-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Source</th>
              <th>Display</th>
              <th>Actual Model</th>
              <th>Provider</th>
              <th>Latency</th>
              <th>Tokens</th>
              <th>Cost</th>
              <th>Reason</th>
              <th>Fallback</th>
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
                    <span className={`table-pill table-pill--source table-pill--source-${log.request_source || "external"}`}>
                      {log.request_source || "external"}
                    </span>
                  </td>
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
