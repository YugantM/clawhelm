export default function Settings({ health, currentUser }) {
  const backendUp = health?.status === "ok";

  return (
    <div className="page-stack">
      <section className="panel">
        <h2>Connection</h2>
        <div className="settings-list">
          <div className="settings-list__row">
            <span>Backend</span>
            <strong className={backendUp ? "status-text--ok" : "status-text--off"}>
              {backendUp ? "Connected" : "Offline"}
            </strong>
          </div>
          <div className="settings-list__row">
            <span>AI routing</span>
            <strong>{health?.allow_openrouter_routing ? "Enabled" : "Disabled"}</strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Account</h2>
        <div className="settings-list">
          {currentUser ? (
            <>
              <div className="settings-list__row">
                <span>Name</span>
                <strong>{currentUser.name || "—"}</strong>
              </div>
              <div className="settings-list__row">
                <span>Email</span>
                <strong>{currentUser.email}</strong>
              </div>
              <div className="settings-list__row">
                <span>Sign-in method</span>
                <strong>{currentUser.provider === "email" ? "Email" : currentUser.provider === "google" ? "Google" : currentUser.provider === "github" ? "GitHub" : currentUser.provider}</strong>
              </div>
            </>
          ) : (
            <div className="settings-list__row">
              <span>Status</span>
              <strong>Guest mode</strong>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>About</h2>
        <div className="settings-list">
          <div className="settings-list__row">
            <span>Version</span>
            <strong>0.1.0</strong>
          </div>
          <div className="settings-list__row">
            <span>Models</span>
            <strong>Auto-selected via OpenRouter</strong>
          </div>
        </div>
      </section>
    </div>
  );
}
