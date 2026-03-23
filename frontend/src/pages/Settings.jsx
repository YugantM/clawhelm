import ProviderConfigPanel from "../components/ProviderConfigPanel";

function maskEmail(email) {
  if (typeof email !== "string" || !email.includes("@")) return "hidden";
  const [namePart, domainPart] = email.split("@");
  const visibleName = namePart.slice(0, 2);
  return `${visibleName}${"*".repeat(Math.max(namePart.length - 2, 1))}@${domainPart}`;
}

function maskUserId(value) {
  if (typeof value !== "string" || value.length < 6) return "hidden";
  return `***${value.slice(-6)}`;
}

function BillingCard({ user, account, health, onCheckout, billingPending }) {
  const isPro = account?.plan === "pro";
  const stripeReady =
    health?.stripe_secret_key_configured && health?.stripe_price_id_configured && health?.stripe_webhook_secret_configured;
  const maskedUser = maskEmail(user?.email || "");
  const maskedUserId = maskUserId(account?.user_id || user?.user_id || "");

  return (
    <section className="settings-card panel">
      <h2>Billing</h2>
      <div className="settings-list">
        <div className="settings-list__row">
          <span>User</span>
          <strong>{maskedUser}</strong>
        </div>
        <div className="settings-list__row">
          <span>User ID</span>
          <strong>{maskedUserId}</strong>
        </div>
        <div className="settings-list__row">
          <span>Plan</span>
          <strong>{account?.plan || "free"}</strong>
        </div>
        <div className="settings-list__row">
          <span>Requests today</span>
          <strong>
            {account?.requests_today ?? 0}
            {account?.remaining == null ? " · unlimited" : ` · ${account?.remaining ?? 0} left`}
          </strong>
        </div>
        <div className="settings-list__row">
          <span>Stripe backend</span>
          <strong>{stripeReady ? "ready" : "missing config"}</strong>
        </div>
      </div>
      <div className="billing-card__actions">
        <button type="button" onClick={onCheckout} disabled={billingPending || isPro || !stripeReady}>
          {isPro ? "Pro Active" : billingPending ? "Redirecting..." : "Upgrade with Stripe"}
        </button>
        {!stripeReady ? <p>Stripe is not fully configured on the Railway backend yet.</p> : null}
      </div>
    </section>
  );
}

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
  user,
  account,
  health,
  providerConfig,
  openrouterDraft,
  onOpenrouterDraftChange,
  onSaveOpenrouterKey,
  onClearOpenrouterKey,
  savingProviderConfig,
  onCheckout,
  billingPending,
}) {
  return (
    <div className="page-stack">
      <BillingCard user={user} account={account} health={health} onCheckout={onCheckout} billingPending={billingPending} />
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
