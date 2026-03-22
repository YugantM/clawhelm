function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value || 0);
}

function formatLatency(value) {
  return `${((value || 0) * 1000).toFixed(1)} ms`;
}

function MetricCard({ label, value, accent }) {
  return (
    <div className={`metric-card metric-card--${accent}`}>
      <span className="metric-card__label">{label}</span>
      <strong className="metric-card__value">{value}</strong>
    </div>
  );
}

export default function Metrics({ stats }) {
  const cards = [
    { label: "Total Requests", value: stats?.total_requests ?? 0, accent: "neutral" },
    { label: "Total Cost", value: formatCurrency(stats?.total_estimated_cost_usd ?? 0), accent: "accent" },
    { label: "Fallback Count", value: stats?.fallback_count ?? 0, accent: "warning" },
    { label: "Avg Latency", value: formatLatency(stats?.avg_latency ?? 0), accent: "success" },
  ];

  return (
    <section className="metrics-bar">
      {cards.map((card) => (
        <MetricCard key={card.label} {...card} />
      ))}
    </section>
  );
}
