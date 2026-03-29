import { useState, useEffect } from "react";

function Bar({ value, max, color = "#3b82f6" }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ background: "var(--bg-secondary)", borderRadius: 4, height: 6, width: "100%", overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.3s" }} />
    </div>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div className="admin-stat-card">
      <div className="admin-stat-value">{value}</div>
      <div className="admin-stat-label">{label}</div>
      {sub && <div className="admin-stat-sub">{sub}</div>}
    </div>
  );
}

function timeAgo(ts) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return `${Math.round(diff / 3600)}h ago`;
}

export default function Admin() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("routing");
  const [allModels, setAllModels] = useState([]);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const [dashRes, modelsRes] = await Promise.all([
          fetch("/admin/dashboard"),
          fetch("/chat/models"),
        ]);
        if (!dashRes.ok) throw new Error(`HTTP ${dashRes.status}`);
        setDashboard(await dashRes.json());
        if (modelsRes.ok) setAllModels(await modelsRes.json());
        setError(null);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
    const id = setInterval(fetchDashboard, 30000);
    return () => clearInterval(id);
  }, []);

  if (loading) return <div className="admin-page"><p>Loading...</p></div>;
  if (error) return <div className="admin-page"><p style={{ color: "#ef4444" }}>Error: {error}</p></div>;

  const { backtest_status, recent_logs = [], model_stats = [], benchmark_results = [] } = dashboard;

  // Summary stats
  const totalRequests = model_stats.reduce((s, m) => s + m.sample_count, 0);
  const avgSuccessRate = model_stats.length
    ? (model_stats.reduce((s, m) => s + m.success_rate, 0) / model_stats.length).toFixed(1)
    : 0;
  const fallbackCount = recent_logs.filter(l => l.fallback_used).length;
  const benchmarkPassed = benchmark_results.filter(b => b.successes > 0).length;

  // Sort model stats by sample count desc
  const topModels = [...model_stats].sort((a, b) => b.sample_count - a.sample_count);
  const maxSamples = topModels[0]?.sample_count || 1;

  // Benchmarks: only show models with at least 1 success, sort by latency
  const benchmarkPassed_list = benchmark_results
    .filter(b => b.successes > 0 && b.avg_latency)
    .sort((a, b) => a.avg_latency - b.avg_latency);
  const maxLatency = benchmarkPassed_list[0]
    ? Math.max(...benchmarkPassed_list.map(b => b.avg_latency))
    : 1;

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Admin Dashboard</h1>
        <div className="admin-status-pill">
          {backtest_status?.status === "running"
            ? `⚡ Backtest running ${backtest_status.completed}/${backtest_status.total}`
            : backtest_status?.status === "completed"
            ? `✅ Backtest complete · ${new Date(backtest_status.last_completed_at * 1000).toLocaleTimeString()}`
            : `Backtest: ${backtest_status?.status || "idle"}`}
        </div>
      </div>

      {/* Summary row */}
      <div className="admin-stats-row">
        <StatCard label="Total Requests" value={totalRequests} />
        <StatCard label="Avg Success Rate" value={`${avgSuccessRate}%`} />
        <StatCard label="Fallbacks (last 20)" value={fallbackCount} sub={`${((fallbackCount/20)*100).toFixed(0)}% of recent`} />
        <StatCard label="Models Benchmarked" value={`${benchmarkPassed}/${benchmark_results.length}`} sub="passed" />
      </div>

      {/* Tabs */}
      <div className="admin-tabs">
        {["routing", "all", "benchmark", "logs"].map(t => (
          <button key={t} className={`admin-tab${tab === t ? " admin-tab--active" : ""}`} onClick={() => setTab(t)}>
            {t === "routing" ? "Live Routing" : t === "all" ? `All Models (${allModels.filter(m=>m.model_id).length})` : t === "benchmark" ? "Benchmarks" : "Recent Logs"}
          </button>
        ))}
      </div>

      {tab === "all" && (() => {
        const statsMap = Object.fromEntries(model_stats.map(m => [m.model_id, m]));
        const benchMap = Object.fromEntries(benchmark_results.map(b => [b.model_id, b]));
        const [sortBy, setSortBy] = [null, () => {}]; // static sort by rank
        const models = allModels.filter(m => m.model_id).sort((a, b) => (a.rank || 999) - (b.rank || 999));
        return (
          <section className="admin-card">
            <h2>All Available Models — {models.length} in pool</h2>
            <div style={{ fontSize: "0.78rem", color: "var(--text-tertiary)", marginBottom: 12 }}>
              Sorted by routing rank. Green = has live data. Blue = benchmarked.
            </div>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Model</th>
                  <th>Free</th>
                  <th>Context</th>
                  <th>Live Req</th>
                  <th>Live Success</th>
                  <th>Live Latency</th>
                  <th>Bench Latency</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m, i) => {
                  const live = statsMap[m.model_id];
                  const bench = benchMap[m.model_id];
                  return (
                    <tr key={i} style={{ opacity: live ? 1 : 0.6 }}>
                      <td style={{ color: "var(--text-tertiary)", fontSize: "0.75rem" }}>{m.rank || "—"}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
                        {live && <span style={{ color: "#22c55e", marginRight: 4 }}>●</span>}
                        {bench?.successes > 0 && <span style={{ color: "#3b82f6", marginRight: 4 }}>●</span>}
                        {m.model_id}
                      </td>
                      <td>{m.is_free ? <span style={{ color: "#22c55e" }}>free</span> : "—"}</td>
                      <td style={{ fontSize: "0.75rem" }}>{m.context_length ? `${Math.round(m.context_length/1000)}k` : "—"}</td>
                      <td>{live ? live.sample_count : "—"}</td>
                      <td style={{ color: live ? (live.success_rate >= 90 ? "#22c55e" : live.success_rate >= 70 ? "#fbbf24" : "#ef4444") : "var(--text-tertiary)" }}>
                        {live ? `${live.success_rate}%` : "no data"}
                      </td>
                      <td>{live ? `${live.avg_latency.toFixed(2)}s` : "—"}</td>
                      <td style={{ color: "#3b82f6" }}>{bench?.avg_latency ? `${bench.avg_latency.toFixed(2)}s` : bench?.successes === 0 ? <span style={{ color: "#ef4444" }}>failed</span> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })()}

      {tab === "routing" && (
        <section className="admin-card">
          <h2>Model Performance — Live Traffic</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Requests</th>
                <th>Success Rate</th>
                <th>Avg Latency</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {topModels.map((m, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{m.model_id}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ minWidth: 28 }}>{m.sample_count}</span>
                      <Bar value={m.sample_count} max={maxSamples} color="#3b82f6" />
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ minWidth: 40, color: m.success_rate >= 90 ? "#22c55e" : m.success_rate >= 70 ? "#fbbf24" : "#ef4444" }}>
                        {m.success_rate}%
                      </span>
                      <Bar value={m.success_rate} max={100} color={m.success_rate >= 90 ? "#22c55e" : m.success_rate >= 70 ? "#fbbf24" : "#ef4444"} />
                    </div>
                  </td>
                  <td>{m.avg_latency ? `${m.avg_latency.toFixed(2)}s` : "—"}</td>
                  <td style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>{timeAgo(m.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "benchmark" && (
        <section className="admin-card">
          <h2>Benchmark Results — Models That Responded</h2>
          {benchmarkPassed_list.length === 0 ? (
            <p style={{ color: "var(--text-tertiary)" }}>No successful benchmark results yet.</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Tests Passed</th>
                  <th>Avg Latency</th>
                  <th>Speed</th>
                </tr>
              </thead>
              <tbody>
                {benchmarkPassed_list.map((b, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{b.model_id}</td>
                    <td>
                      <span style={{ color: b.successes === 3 ? "#22c55e" : "#fbbf24" }}>
                        {b.successes}/{b.tests}
                      </span>
                    </td>
                    <td>{b.avg_latency.toFixed(2)}s</td>
                    <td style={{ width: 160 }}>
                      <Bar value={maxLatency - b.avg_latency} max={maxLatency} color="#22c55e" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p style={{ marginTop: 12, fontSize: "0.78rem", color: "var(--text-tertiary)" }}>
            {benchmark_results.filter(b => b.successes === 0).length} models failed all benchmark prompts
          </p>
        </section>
      )}

      {tab === "logs" && (
        <section className="admin-card">
          <h2>Recent Routing Decisions</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Selected</th>
                <th>Actual</th>
                <th>Latency</th>
                <th>Status</th>
                <th>Fallback</th>
              </tr>
            </thead>
            <tbody>
              {recent_logs.map((log, i) => (
                <tr key={i}>
                  <td style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", whiteSpace: "nowrap" }}>{timeAgo(log.timestamp)}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{log.selected_model?.split("/").pop()}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{log.actual_model?.split("/").pop()}</td>
                  <td style={{ color: log.latency > 10 ? "#fbbf24" : "inherit" }}>{log.latency?.toFixed(2)}s</td>
                  <td>{log.status_code < 400 ? "✅" : "❌"}</td>
                  <td>{log.fallback_used ? <span style={{ color: "#fbbf24" }}>↩ fallback</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
