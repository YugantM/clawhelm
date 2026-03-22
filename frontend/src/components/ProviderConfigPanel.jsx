export default function ProviderConfigPanel({
  providerConfig,
  openrouterDraft,
  onDraftChange,
  onSave,
  onClear,
  saving,
}) {
  const openrouter = providerConfig?.providers?.openrouter;

  return (
    <section className="provider-config panel">
      <div className="provider-config__header">
        <div>
          <h2>Provider Keys</h2>
          <p>Persist your OpenRouter key inside the local ClawHelm install so routing works without exporting shell variables every time.</p>
        </div>
        <div className="provider-config__meta">
          <span>Active source</span>
          <strong>{openrouter?.source || "missing"}</strong>
        </div>
      </div>

      <div className="provider-config__grid">
        <label className="provider-config__field provider-config__field--wide">
          <span>OpenRouter API key</span>
          <input
            type="password"
            value={openrouterDraft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder={openrouter?.configured ? `Current ${openrouter.masked_key || "configured"}` : "sk-or-v1-..."}
          />
        </label>

        <div className="provider-config__state">
          <span>Configured key</span>
          <strong>{openrouter?.configured ? openrouter.masked_key || "Configured" : "Not configured"}</strong>
        </div>
      </div>

      <div className="provider-config__actions">
        <button type="button" className="action-button" onClick={onSave} disabled={saving}>
          {saving ? "Saving..." : "Save key"}
        </button>
        <button type="button" className="ghost-button" onClick={onClear} disabled={saving || !openrouter?.configured}>
          Clear saved key
        </button>
      </div>
    </section>
  );
}
