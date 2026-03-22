import ProviderConfigPanel from "../components/ProviderConfigPanel";

function RuntimeInfoCard({ health, providerConfig }) {
  const openrouter = providerConfig?.providers?.openrouter;
  const openai = providerConfig?.providers?.openai;

  return (
    <section className="settings-grid">
      <div className="settings-card panel">
        <h2>Runtime</h2>
        <div className="settings-list">
          <div className="settings-list__row">
            <span>Service</span>
            <strong>{health?.service || "clawhelm"}</strong>
          </div>
          <div className="settings-list__row">
            <span>Database</span>
            <strong>{health?.db_path || "unknown"}</strong>
          </div>
          <div className="settings-list__row">
            <span>Settings file</span>
            <strong>{health?.settings_path || providerConfig?.settings_path || "unknown"}</strong>
          </div>
          <div className="settings-list__row">
            <span>Provider base URL</span>
            <strong>{health?.provider_base_url || "unknown"}</strong>
          </div>
        </div>
      </div>

      <div className="settings-card panel">
        <h2>Provider Status</h2>
        <div className="settings-list">
          <div className="settings-list__row">
            <span>OpenRouter key</span>
            <strong>{openrouter?.configured ? `${openrouter.source} · ${openrouter.masked_key || "configured"}` : "missing"}</strong>
          </div>
          <div className="settings-list__row">
            <span>OpenAI key</span>
            <strong>{openai?.configured ? `${openai.source} · ${openai.masked_key || "configured"}` : "missing"}</strong>
          </div>
          <div className="settings-list__row">
            <span>OpenRouter routing</span>
            <strong>{health?.allow_openrouter_routing ? "enabled" : "disabled"}</strong>
          </div>
          <div className="settings-list__row">
            <span>OpenAI routing</span>
            <strong>{health?.allow_openai_routing ? "enabled" : "disabled"}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

function FutureConfigCard() {
  const items = [
    "Default provider policy",
    "Routing thresholds and score weights",
    "Fallback ceilings",
    "Per-workspace OpenClaw integration",
    "Team-level provider credentials",
  ];

  return (
    <section className="settings-card panel">
      <h2>Future Config Surface</h2>
      <p>Reserve this page for stable operator settings instead of scattering controls across metrics and chat views.</p>
      <ul className="settings-roadmap">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export default function Settings({
  health,
  providerConfig,
  openrouterDraft,
  onOpenrouterDraftChange,
  onSaveOpenrouterKey,
  onClearOpenrouterKey,
  savingProviderConfig,
}) {
  return (
    <div className="page-stack">
      <ProviderConfigPanel
        providerConfig={providerConfig}
        openrouterDraft={openrouterDraft}
        onDraftChange={onOpenrouterDraftChange}
        onSave={onSaveOpenrouterKey}
        onClear={onClearOpenrouterKey}
        saving={savingProviderConfig}
      />
      <RuntimeInfoCard health={health} providerConfig={providerConfig} />
      <FutureConfigCard />
    </div>
  );
}
