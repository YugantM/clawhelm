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

function formatPercent(value) {
  if (value == null) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

export default function ScoringTable({ stats }) {
  const candidates = stats?.candidate_scores || [];

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Routing Scoreboard</h2>
          <p>Current candidate ranking from live performance data, cost, and latency.</p>
        </div>
      </div>
      <div className="table-shell">
        <table className="logs-table scoring-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Model</th>
              <th>Provider</th>
              <th>Final Score</th>
              <th>Success</th>
              <th>Confidence</th>
              <th>Latency</th>
              <th>Latency Score</th>
              <th>Cost</th>
              <th>Cost Score</th>
              <th>Samples</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {candidates.length === 0 ? (
              <tr>
                <td colSpan="12" className="empty-state">No candidate scores available yet.</td>
              </tr>
            ) : (
              candidates.map((candidate) => (
                <tr key={candidate.model_id} className={candidate.excluded ? "logs-table__row logs-table__row--fallback" : "logs-table__row"}>
                  <td>{candidate.rank}</td>
                  <td>
                    <div className="model-cell">
                      <span>{candidate.model_id}</span>
                      <span className="model-cell__score">
                        {candidate.is_free ? "free" : "paid"}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={`table-pill table-pill--${candidate.provider || "unknown"}`}>
                      {candidate.provider || "-"}
                    </span>
                  </td>
                  <td>{formatScore(candidate.score)}</td>
                  <td>{formatPercent(candidate.success_rate)}</td>
                  <td>{formatPercent(candidate.confidence)}</td>
                  <td>{formatLatency(candidate.avg_latency)}</td>
                  <td>{formatScore(candidate.latency_score)}</td>
                  <td>{formatCurrency(candidate.avg_cost)}</td>
                  <td>{formatScore(candidate.cost_score)}</td>
                  <td>{candidate.sample_count}</td>
                  <td>{candidate.excluded ? "Excluded" : "Eligible"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
