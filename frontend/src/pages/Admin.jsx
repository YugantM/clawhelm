import { useState, useEffect } from "react";

export default function Admin() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const response = await fetch("/admin/dashboard");
        if (!response.ok) throw new Error("Failed to fetch dashboard");
        const data = await response.json();
        setDashboard(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboard();
    const interval = setInterval(fetchDashboard, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div className="admin-page">Loading dashboard...</div>;
  if (error) return <div className="admin-page error">Error: {error} (waiting for backend...)</div>;
  if (!dashboard) return <div className="admin-page">No data available</div>;

  const { health, backtest_status, recent_logs, model_stats, benchmark_results } = dashboard;

  return (
    <div className="admin-page">
      <h1>Admin Dashboard</h1>

      {/* Health Status */}
      <section className="admin-card">
        <h2>System Status</h2>
        <p>
          <strong>Status:</strong> {health?.status === "ok" ? "✅ OK" : "❌ Down"}
        </p>
        {health?.last_refresh && (
          <p>
            <strong>Models Last Refreshed:</strong> {new Date(health.last_refresh).toLocaleString()}
          </p>
        )}
      </section>

      {/* Backtest Scheduler */}
      <section className="admin-card">
        <h2>Backtest Scheduler</h2>
        <p>
          <strong>Status:</strong> {backtest_status?.status || "idle"}
        </p>
        {backtest_status?.status === "running" && (
          <p>
            Progress: {backtest_status.completed} / {backtest_status.total}
          </p>
        )}
        {backtest_status?.last_completed_at && (
          <p>
            <strong>Last Run:</strong>{" "}
            {new Date(backtest_status.last_completed_at * 1000).toLocaleString()}
          </p>
        )}
      </section>

      {/* Benchmark Results */}
      {benchmark_results?.length > 0 && (
        <section className="admin-card">
          <h2>Latest Benchmark Results</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Provider</th>
                <th>Avg Latency (s)</th>
              </tr>
            </thead>
            <tbody>
              {benchmark_results.slice(0, 10).map((r, i) => (
                <tr key={i}>
                  <td>{r.model_id}</td>
                  <td>{r.provider}</td>
                  <td>{r.avg_latency?.toFixed(3) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Model Stats */}
      {model_stats?.length > 0 && (
        <section className="admin-card">
          <h2>Model Performance (Live Traffic)</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Requests</th>
                <th>Success %</th>
                <th>Avg Latency (s)</th>
                <th>Avg Cost</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {model_stats.slice(0, 15).map((s, i) => (
                <tr key={i}>
                  <td>{s.model_id}</td>
                  <td>{s.sample_count}</td>
                  <td>{s.success_rate}%</td>
                  <td>{s.avg_latency?.toFixed(3) || "—"}</td>
                  <td>${s.avg_cost?.toFixed(6) || "—"}</td>
                  <td>{new Date(s.last_seen).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Recent Logs */}
      {recent_logs?.length > 0 && (
        <section className="admin-card">
          <h2>Recent Routing Decisions</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Selected Model</th>
                <th>Actual Model</th>
                <th>Latency (s)</th>
                <th>Status</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {recent_logs.slice(0, 10).map((log, i) => (
                <tr key={i}>
                  <td>{new Date(log.timestamp).toLocaleString()}</td>
                  <td>{log.selected_model}</td>
                  <td>{log.actual_model}</td>
                  <td>{log.latency?.toFixed(3) || "—"}</td>
                  <td>{log.status_code ? (log.status_code < 400 ? "✅" : "❌") : "—"}</td>
                  <td>{log.routing_score?.toFixed(3) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
