import { useState } from "react";

export default function LoginPage({ onSignup, onLogin, onOAuth, pending, error, oauthReady }) {
  const [mode, setMode] = useState("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    const payload = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password,
    };
    if (mode === "signup") {
      onSignup(payload);
      return;
    }
    onLogin(payload);
  }

  return (
    <section className="login-shell panel" id="login-panel">
      <div className="login-shell__hero">
        <span className="login-shell__eyebrow">Account Access</span>
        <h1>Sign up for ClawHelm Cloud</h1>
        <p>
          Use a minimal email form or continue with Google or GitHub. Payment unlocks are attached to the authenticated
          backend user on Railway.
        </p>
      </div>

      <div className="access-toggle" role="tablist" aria-label="Auth mode">
        <button
          type="button"
          className={mode === "signup" ? "access-toggle__button access-toggle__button--active" : "access-toggle__button"}
          onClick={() => setMode("signup")}
        >
          Sign up
        </button>
        <button
          type="button"
          className={mode === "login" ? "access-toggle__button access-toggle__button--active" : "access-toggle__button"}
          onClick={() => setMode("login")}
        >
          Log in
        </button>
      </div>

      <form className="login-form" onSubmit={handleSubmit}>
        {mode === "signup" ? (
          <label>
            <span>Name</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
            />
          </label>
        ) : null}
        <label>
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
          />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
            minLength={8}
            required
          />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "Working..." : mode === "signup" ? "Create account" : "Log in"}
        </button>
      </form>

      <div className="login-divider">
        <span>or continue with</span>
      </div>

      <div className="login-oauth-grid">
        <button type="button" className="ghost-button" disabled={!oauthReady.google || pending} onClick={() => onOAuth("google")}>
          Google
        </button>
        <button type="button" className="ghost-button" disabled={!oauthReady.github || pending} onClick={() => onOAuth("github")}>
          GitHub
        </button>
      </div>

      {!oauthReady.google || !oauthReady.github ? (
        <p className="login-shell__hint">OAuth buttons activate when the matching backend client id and secret are configured.</p>
      ) : null}

      {error ? <div className="error-banner">{error}</div> : null}
    </section>
  );
}
