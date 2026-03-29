import { useState, useEffect, useCallback, useRef } from "react";

const API_BASE = import.meta.env.DEV ? "" : (import.meta.env.VITE_API_BASE_URL || "");

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

function SortTh({ col, label, sort, onSort }) {
  const active = sort.col === col;
  return (
    <th onClick={() => onSort(col)} style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
      {label}
      <span style={{ marginLeft: 4, opacity: active ? 1 : 0.3, fontSize: "0.7rem" }}>
        {active ? (sort.dir === "asc" ? "▲" : "▼") : "⇅"}
      </span>
    </th>
  );
}

function timeAgo(ts) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return `${Math.round(diff / 3600)}h ago`;
}

const PROVIDERS = ["all", "openrouter", "groq", "google", "openai"];

export default function Admin() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("routing");
  const [allModels, setAllModels] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);

  // All Models tab filters + sort
  const [search, setSearch] = useState("");
  const [filterProvider, setFilterProvider] = useState("all");
  const [filterFree, setFilterFree] = useState("all"); // all | free | paid
  const [filterLive, setFilterLive] = useState(false);
  const [sort, setSort] = useState({ col: "rank", dir: "asc" });

  // Routing tab
  const [rtSearch, setRtSearch] = useState("");
  const [rtSort, setRtSort] = useState({ col: "live_req", dir: "desc" });

  // Benchmark tab
  const [bSort, setBSort] = useState({ col: "bench_latency", dir: "asc" });

  const backtestRunning = useRef(false);

  const fetchDashboard = useCallback(async () => {
    try {
      const [dashRes, modelsRes] = await Promise.all([
        fetch(`${API_BASE}/admin/dashboard`),
        fetch(`${API_BASE}/chat/models`),
      ]);
      if (!dashRes.ok) throw new Error(`HTTP ${dashRes.status}`);
      const dash = await dashRes.json();
      setDashboard(dash);
      if (modelsRes.ok) setAllModels(await modelsRes.json());
      setLastUpdated(new Date());
      setError(null);
      backtestRunning.current = dash.backtest_status?.status === "running";
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Fast poll (5s) while backtest running, slow (15s) otherwise
  useEffect(() => {
    const tick = () => {
      const interval = backtestRunning.current ? 5000 : 15000;
      return setTimeout(async () => {
        await fetchDashboard();
        timerId = tick();
      }, interval);
    };
    let timerId = tick();
    return () => clearTimeout(timerId);
  }, [fetchDashboard]);

  function handleSort(col) {
    setSort(prev => ({ col, dir: prev.col === col && prev.dir === "asc" ? "desc" : "asc" }));
  }

  if (loading) return <div className="admin-page"><p>Loading...</p></div>;
  if (error) return <div className="admin-page"><p style={{ color: "#ef4444" }}>Error: {error}</p></div>;

  const { backtest_status, recent_logs = [], model_stats = [], benchmark_results = [] } = dashboard;

  const totalRequests = model_stats.reduce((s, m) => s + m.sample_count, 0);
  const avgSuccessRate = model_stats.length
    ? (model_stats.reduce((s, m) => s + m.success_rate, 0) / model_stats.length).toFixed(1)
    : 0;
  const fallbackCount = recent_logs.filter(l => l.fallback_used).length;
  const benchmarkPassed = benchmark_results.filter(b => b.successes > 0).length;

  const topModels = [...model_stats].sort((a, b) => b.sample_count - a.sample_count);
  const maxSamples = topModels[0]?.sample_count || 1;

  const benchmarkPassed_list = benchmark_results
    .filter(b => b.successes > 0 && b.avg_latency)
    .sort((a, b) => a.avg_latency - b.avg_latency);
  const maxLatency = benchmarkPassed_list.length
    ? Math.max(...benchmarkPassed_list.map(b => b.avg_latency))
    : 1;

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Admin Dashboard</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {lastUpdated && (
            <span style={{ fontSize: "0.72rem", color: "var(--text-tertiary)" }}>
              Updated {timeAgo(lastUpdated)}
            </span>
          )}
          <button className="admin-refresh-btn" onClick={fetchDashboard} title="Refresh now">↻</button>
          <div className="admin-status-pill">
            {backtest_status?.status === "running"
              ? `⚡ Backtest ${backtest_status.completed}/${backtest_status.total}`
              : backtest_status?.status === "completed"
              ? `✅ Backtest · ${new Date(backtest_status.last_completed_at * 1000).toLocaleTimeString()}`
              : `Backtest: ${backtest_status?.status || "idle"}`}
          </div>
        </div>
      </div>

      <div className="admin-stats-row">
        <StatCard label="Total Requests" value={totalRequests} />
        <StatCard label="Avg Success Rate" value={`${avgSuccessRate}%`} />
        <StatCard label="Fallbacks (last 20)" value={fallbackCount} sub={`${((fallbackCount/20)*100).toFixed(0)}% of recent`} />
        <StatCard label="Models Benchmarked" value={`${benchmarkPassed}/${benchmark_results.length}`} sub="free models" />
      </div>

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

        let models = allModels.filter(m => m.model_id);

        // Filters
        if (search) {
          const q = search.toLowerCase();
          models = models.filter(m => m.model_id.toLowerCase().includes(q));
        }
        if (filterProvider !== "all") {
          models = models.filter(m => m.provider === filterProvider);
        }
        if (filterFree === "free") models = models.filter(m => m.is_free);
        if (filterFree === "paid") models = models.filter(m => !m.is_free);
        if (filterLive) models = models.filter(m => statsMap[m.model_id]);

        // Sorting
        models = [...models].sort((a, b) => {
          let av, bv;
          const la = statsMap[a.model_id], lb = statsMap[b.model_id];
          const ba = benchMap[a.model_id], bb = benchMap[b.model_id];
          switch (sort.col) {
            case "rank": av = a.rank || 999; bv = b.rank || 999; break;
            case "model": av = a.model_id; bv = b.model_id; break;
            case "provider": av = a.provider || ""; bv = b.provider || ""; break;
            case "context": av = a.context_length || 0; bv = b.context_length || 0; break;
            case "live_req": av = la?.sample_count || 0; bv = lb?.sample_count || 0; break;
            case "live_success": av = la?.success_rate ?? -1; bv = lb?.success_rate ?? -1; break;
            case "live_latency": av = la?.avg_latency ?? 999; bv = lb?.avg_latency ?? 999; break;
            case "bench_latency": av = ba?.avg_latency ?? 999; bv = bb?.avg_latency ?? 999; break;
            default: av = a.rank || 999; bv = b.rank || 999;
          }
          if (av < bv) return sort.dir === "asc" ? -1 : 1;
          if (av > bv) return sort.dir === "asc" ? 1 : -1;
          return 0;
        });

        const availableProviders = [...new Set(allModels.map(m => m.provider).filter(Boolean))].sort();

        return (
          <section className="admin-card">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
              <input
                className="admin-search"
                placeholder="Search models…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <select className="admin-select" value={filterProvider} onChange={e => setFilterProvider(e.target.value)}>
                <option value="all">All providers</option>
                {availableProviders.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <select className="admin-select" value={filterFree} onChange={e => setFilterFree(e.target.value)}>
                <option value="all">Free + paid</option>
                <option value="free">Free only</option>
                <option value="paid">Paid only</option>
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.78rem", cursor: "pointer", color: "var(--text-secondary)" }}>
                <input type="checkbox" checked={filterLive} onChange={e => setFilterLive(e.target.checked)} />
                Live only
              </label>
              <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
                {models.length} models
              </span>
            </div>
            <table className="admin-table">
              <thead>
                <tr>
                  <SortTh col="rank" label="#" sort={sort} onSort={handleSort} />
                  <SortTh col="model" label="Model" sort={sort} onSort={handleSort} />
                  <SortTh col="provider" label="Provider" sort={sort} onSort={handleSort} />
                  <th>Free</th>
                  <SortTh col="context" label="Context" sort={sort} onSort={handleSort} />
                  <SortTh col="live_req" label="Live Req" sort={sort} onSort={handleSort} />
                  <SortTh col="live_success" label="Live Success" sort={sort} onSort={handleSort} />
                  <SortTh col="live_latency" label="Live Latency" sort={sort} onSort={handleSort} />
                  <SortTh col="bench_latency" label="Bench Latency" sort={sort} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {models.map((m, i) => {
                  const live = statsMap[m.model_id];
                  const bench = benchMap[m.model_id];
                  const benchLatency = bench?.avg_latency ?? null;
                  return (
                    <tr key={i} style={{ opacity: live ? 1 : 0.6 }}>
                      <td style={{ color: "var(--text-tertiary)", fontSize: "0.75rem" }}>{m.rank || "—"}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
                        {live && <span style={{ color: "#22c55e", marginRight: 4 }}>●</span>}
                        {bench?.successes > 0 && <span style={{ color: "#3b82f6", marginRight: 4 }}>●</span>}
                        {m.model_id}
                      </td>
                      <td style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{m.provider || "—"}</td>
                      <td>{m.is_free ? <span style={{ color: "#22c55e" }}>free</span> : "—"}</td>
                      <td style={{ fontSize: "0.75rem" }}>{m.context_length ? `${Math.round(m.context_length/1000)}k` : "—"}</td>
                      <td>{live ? live.sample_count : "—"}</td>
                      <td style={{ color: live ? (live.success_rate >= 90 ? "#22c55e" : live.success_rate >= 70 ? "#fbbf24" : "#ef4444") : "var(--text-tertiary)" }}>
                        {live ? `${live.success_rate}%` : "no data"}
                      </td>
                      <td>{live ? `${live.avg_latency.toFixed(2)}s` : "—"}</td>
                      <td style={{ color: "#3b82f6" }}>
                        {benchLatency !== null ? `${benchLatency.toFixed(2)}s` : bench?.successes === 0 ? <span style={{ color: "#ef4444" }}>failed</span> : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })()}

      {tab === "routing" && (() => {
        function handleRtSort(col) {
          setRtSort(prev => ({ col, dir: prev.col === col && prev.dir === "asc" ? "desc" : "asc" }));
        }
        let rows = [...topModels];
        if (rtSearch) rows = rows.filter(m => m.model_id.toLowerCase().includes(rtSearch.toLowerCase()));
        rows = rows.sort((a, b) => {
          let av, bv;
          switch (rtSort.col) {
            case "live_req": av = a.sample_count; bv = b.sample_count; break;
            case "live_success": av = a.success_rate; bv = b.success_rate; break;
            case "live_latency": av = a.avg_latency ?? 999; bv = b.avg_latency ?? 999; break;
            case "model": av = a.model_id; bv = b.model_id; break;
            default: av = a.sample_count; bv = b.sample_count;
          }
          if (av < bv) return rtSort.dir === "asc" ? -1 : 1;
          if (av > bv) return rtSort.dir === "asc" ? 1 : -1;
          return 0;
        });
        const maxS = rows[0]?.sample_count || 1;
        return (
          <section className="admin-card">
            <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
              <input className="admin-search" placeholder="Search models…" value={rtSearch} onChange={e => setRtSearch(e.target.value)} />
              <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--text-tertiary)" }}>{rows.length} models</span>
            </div>
            <table className="admin-table">
              <thead>
                <tr>
                  <SortTh col="model" label="Model" sort={rtSort} onSort={handleRtSort} />
                  <SortTh col="live_req" label="Requests" sort={rtSort} onSort={handleRtSort} />
                  <SortTh col="live_success" label="Success Rate" sort={rtSort} onSort={handleRtSort} />
                  <SortTh col="live_latency" label="Avg Latency" sort={rtSort} onSort={handleRtSort} />
                  <th>Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{m.model_id}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ minWidth: 28 }}>{m.sample_count}</span>
                        <Bar value={m.sample_count} max={maxS} color="#3b82f6" />
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
        );
      })()}

      {tab === "benchmark" && (() => {
        function handleBSort(col) {
          setBSort(prev => ({ col, dir: prev.col === col && prev.dir === "asc" ? "desc" : "asc" }));
        }
        let rows = [...benchmarkPassed_list].sort((a, b) => {
          let av, bv;
          switch (bSort.col) {
            case "model": av = a.model_id; bv = b.model_id; break;
            case "passed": av = a.successes; bv = b.successes; break;
            case "bench_latency": av = a.avg_latency; bv = b.avg_latency; break;
            default: av = a.avg_latency; bv = b.avg_latency;
          }
          if (av < bv) return bSort.dir === "asc" ? -1 : 1;
          if (av > bv) return bSort.dir === "asc" ? 1 : -1;
          return 0;
        });
        return (
          <section className="admin-card">
            <h2>Benchmark Results — Free Models Only</h2>
            {rows.length === 0 ? (
              <p style={{ color: "var(--text-tertiary)" }}>No successful benchmark results yet.</p>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <SortTh col="model" label="Model" sort={bSort} onSort={handleBSort} />
                    <SortTh col="passed" label="Tests Passed" sort={bSort} onSort={handleBSort} />
                    <SortTh col="bench_latency" label="Avg Latency" sort={bSort} onSort={handleBSort} />
                    <th>Speed</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b, i) => (
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
        );
      })()}

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
