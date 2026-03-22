import Charts from "../components/Charts";

export default function Dashboard({ stats }) {
  return (
    <div className="page-stack">
      <Charts stats={stats} />
    </div>
  );
}
