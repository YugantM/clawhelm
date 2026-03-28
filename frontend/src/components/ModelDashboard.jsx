import { useEffect, useState } from "react";
import { getStats } from "../api";

function formatLatency(val) {
  if (val == null) return "—";
  if (val < 1) return `${Math.round(val * 1000)}ms`;
  return `${val.toFixed(1)}s`;
}

function formatPercent(val) {
  if (val == null) return "—";
  return `${(val * 100).toFixed(1)}%`;
}

function successClass(rate) {
  if (rate >= 0.95) return "stat--good";
  if (rate >= 0.8) return "stat--warn";
  return "stat--bad";
}

function formatModelName(name) {
  // Remove common prefixes for cleaner display
  return name.replace(/^(openrouter\/|openai\/)/, "");
}

export default function ModelDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await getStats();
      setStats(data);
    } catch (err) {
      console.error("Failed to load stats:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (!stats) {
    return loading ? (
      <div className="dashboard-empty">Loading stats...</div>
    ) : (
      <div className="dashboard-empty">Failed to load model stats</div>
    );
  }

  const perfModels = stats.performance_by_model || {};
  const modelEntries = Object.entries(perfModels)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  const totalReqs = stats.total_requests || 0;
  const successRate = totalReqs > 0
    ? (stats.successful_requests || 0) / totalReqs
    : 0;
  const maxScore = modelEntries.length > 0
    ? Math.max(...modelEntries.map((m) => m.score || 0), 1)
    : 1;

  return (
    <div>
      <button type="button" className="dashboard-refresh" onClick={load} disabled={loading}>
        {loading ? "Loading..." : "Refresh"}
      </button>

      <div className="dashboard-overview">
        <div className="dashboard-stat">
          <div className="dashboard-stat__label">Total Requests</div>
          <div className="dashboard-stat__value">{totalReqs.toLocaleString()}</div>
        </div>
        <div className="dashboard-stat">
          <div className="dashboard-stat__label">Success Rate</div>
          <div className={`dashboard-stat__value ${successClass(successRate)}`}>
            {formatPercent(successRate)}
          </div>
        </div>
        <div className="dashboard-stat">
          <div className="dashboard-stat__label">Avg Latency</div>
          <div className="dashboard-stat__value">{formatLatency(stats.avg_latency)}</div>
        </div>
        <div className="dashboard-stat">
          <div className="dashboard-stat__label">Total Cost</div>
          <div className="dashboard-stat__value">
            ${(stats.total_estimated_cost_usd || 0).toFixed(4)}
          </div>
        </div>
      </div>

      {modelEntries.length === 0 ? (
        <div className="dashboard-empty">
          No data yet — start chatting to see model performance
        </div>
      ) : (
        <table className="model-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Reqs</th>
              <th>Success</th>
              <th>Latency</th>
              <th>Rank</th>
            </tr>
          </thead>
          <tbody>
            {modelEntries.map((m, idx) => (
              <tr key={m.name}>
                <td className="model-table__name" title={m.name}>
                  {formatModelName(m.name)}
                </td>
                <td>{m.sample_count || 0}</td>
                <td>
                  <span className={successClass(m.success_rate)}>
                    {formatPercent(m.success_rate)}
                  </span>
                </td>
                <td>{formatLatency(m.avg_latency)}</td>
                <td>
                  <span className="rank-badge rank-badge--small">#{idx + 1}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
