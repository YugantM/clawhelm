import ProviderConfigPanel from "../components/ProviderConfigPanel";
import Charts from "../components/Charts";
import Metrics from "../components/Metrics";

export default function Dashboard({
  stats,
  showProviderConfig,
  providerConfig,
  openrouterDraft,
  onOpenrouterDraftChange,
  onSaveOpenrouterKey,
  onClearOpenrouterKey,
  savingProviderConfig,
}) {
  return (
    <div className="page-stack">
      <Metrics stats={stats} />
      {showProviderConfig ? (
        <ProviderConfigPanel
          providerConfig={providerConfig}
          openrouterDraft={openrouterDraft}
          onDraftChange={onOpenrouterDraftChange}
          onSave={onSaveOpenrouterKey}
          onClear={onClearOpenrouterKey}
          saving={savingProviderConfig}
        />
      ) : null}
      <Charts stats={stats} />
    </div>
  );
}
