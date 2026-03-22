function shortenModelName(modelId) {
  if (!modelId) return "Unknown model";
  const compact = modelId.split("/").pop() || modelId;
  if (compact.length <= 28) return compact;
  return `${compact.slice(0, 25)}...`;
}

function mapModelData(stats) {
  return Object.entries(stats?.requests_by_actual_model || {})
    .map(([label, value]) => ({ label, shortLabel: shortenModelName(label), value }))
    .sort((left, right) => right.value - left.value);
}

function mapProviderData(stats) {
  return Object.entries(stats?.requests_by_provider || {})
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value);
}

function formatPercent(value, total) {
  if (!total) return "0%";
  return `${((value / total) * 100).toFixed(0)}%`;
}

function ModelUsageList({ data }) {
  if (data.length === 0) return <div className="chart-empty">No model distribution yet</div>;
  const max = Math.max(...data.map((item) => item.value), 1);
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const visibleRows = data.slice(0, 6);

  return (
    <div className="usage-list">
      {visibleRows.map((item, index) => (
        <div key={item.label} className="usage-row">
          <div className="usage-rank">{index + 1}</div>
          <div className="usage-model">
            <div className="usage-model__title">
              <strong>{item.shortLabel}</strong>
              <span>{formatPercent(item.value, total)}</span>
            </div>
            <span className="usage-model__subtitle" title={item.label}>
              {item.label}
            </span>
          </div>
          <div className="usage-bar">
            <div className="usage-bar__track">
              <div className="usage-bar__fill" style={{ width: `${(item.value / max) * 100}%` }} />
            </div>
          </div>
          <div className="usage-value">{item.value}</div>
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
            <p>Most-used real answering models, ranked by request volume.</p>
          </div>
        </div>
        <ModelUsageList data={modelData} />
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
