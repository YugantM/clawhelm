function mapModelData(stats) {
  return Object.entries(stats?.requests_by_actual_model || {}).map(([label, value]) => ({ label, value }));
}

function mapProviderData(stats) {
  return Object.entries(stats?.requests_by_provider || {}).map(([label, value]) => ({ label, value }));
}

function BarChart({ data }) {
  if (data.length === 0) return <div className="chart-empty">No model distribution yet</div>;
  const max = Math.max(...data.map((item) => item.value), 1);
  return (
    <div className="bars">
      {data.map((item) => (
        <div key={item.label} className="bar-row">
          <span className="bar-label">{item.label}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
          <span className="bar-value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function PieChart({ data }) {
  if (data.length === 0) return <div className="chart-empty">No provider distribution yet</div>;
  const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
  const colors = ["#7dd3fc", "#f59e0b", "#34d399", "#f87171"];
  let start = 0;
  const slices = data.map((item, index) => {
    const value = item.value / total;
    const end = start + value;
    const largeArc = value > 0.5 ? 1 : 0;
    const x1 = 50 + 40 * Math.cos(2 * Math.PI * start - Math.PI / 2);
    const y1 = 50 + 40 * Math.sin(2 * Math.PI * start - Math.PI / 2);
    const x2 = 50 + 40 * Math.cos(2 * Math.PI * end - Math.PI / 2);
    const y2 = 50 + 40 * Math.sin(2 * Math.PI * end - Math.PI / 2);
    start = end;
    return (
      <path
        key={item.label}
        d={`M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z`}
        fill={colors[index % colors.length]}
      />
    );
  });

  return (
    <div className="pie-shell">
      <svg viewBox="0 0 100 100" className="pie-svg">
        {slices}
      </svg>
      <div className="legend">
        {data.map((item, index) => (
          <div key={item.label} className="legend-row">
            <span className="legend-dot" style={{ backgroundColor: colors[index % colors.length] }} />
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Charts({ stats }) {
  const modelData = mapModelData(stats);
  const providerData = mapProviderData(stats);

  return (
    <section className="intel-grid">
      <div className="panel">
        <div className="section-heading">
          <div>
            <h2>Actual Models</h2>
            <p>How frequently each real answering model is used.</p>
          </div>
        </div>
        <BarChart data={modelData} />
      </div>
      <div className="panel">
        <div className="section-heading">
          <div>
            <h2>Providers</h2>
            <p>Current usage split across providers.</p>
          </div>
        </div>
        <PieChart data={providerData} />
      </div>
    </section>
  );
}
