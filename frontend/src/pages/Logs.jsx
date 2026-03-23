import LogsTable from "../components/LogsTable";

export default function Logs({ logs, loading, compact = false }) {
  return <LogsTable logs={logs} loading={loading} compact={compact} />;
}
