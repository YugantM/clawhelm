import LogsTable from "../components/LogsTable";

export default function Logs({ logs, loading }) {
  return <LogsTable logs={logs} loading={loading} />;
}
