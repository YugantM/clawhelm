import React, { useEffect, useState } from "react";
import { setAuthToken } from "../api";

const API_BASE = import.meta.env.DEV ? "" : (import.meta.env.VITE_API_BASE_URL || "");

export default function LoginModal({ isOpen, onLoginSuccess, onSkip, authError }) {
  const [providers, setProviders] = useState({ google: false, github: false, email: true });
  const [mode, setMode] = useState("choose"); // choose | login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    fetch(`${API_BASE}/auth/providers`)
      .then(r => r.json())
      .then(setProviders)
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (authError) setError(authError);
  }, [authError]);

  if (!isOpen) return null;

  function handleGoogleLogin() {
    const redirectTo = encodeURIComponent(window.location.origin + window.location.pathname);
    window.location.href = `${API_BASE}/auth/google/login?redirect_to=${redirectTo}`;
  }

  function handleGitHubLogin() {
    const redirectTo = encodeURIComponent(window.location.origin + window.location.pathname);
    window.location.href = `${API_BASE}/auth/github/login?redirect_to=${redirectTo}`;
  }

  async function handleEmailSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const endpoint = mode === "signup" ? "/auth/signup" : "/auth/login";
      const body = mode === "signup"
        ? { email, password, name: name || undefined }
        : { email, password };

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Authentication failed");
      if (data.access_token) {
        setAuthToken(data.access_token);
      }
      onLoginSuccess(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-modal-overlay">
      <div className="login-modal">
        <div className="login-modal__logo">
          <span className="login-modal__brand"><span className="brand--white">Claw</span><span className="brand--gradient">Helm</span></span>
        </div>

        <h2 className="login-modal__title">
          {mode === "signup" ? "Create account" : mode === "login" ? "Sign in" : "Welcome back"}
        </h2>
        <p className="login-modal__sub">
          {mode === "choose"
            ? "Sign in to save chats and sync across devices"
            : mode === "signup"
            ? "Create a free account to get started"
            : "Sign in to your account"}
        </p>

        {/* OAuth buttons — always shown */}
        {(providers.google || providers.github) && (
          <div className="login-oauth">
            {providers.google && (
              <button className="login-btn login-btn--google" onClick={handleGoogleLogin}>
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </button>
            )}
            {providers.github && (
              <button className="login-btn login-btn--github" onClick={handleGitHubLogin}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
                </svg>
                Continue with GitHub
              </button>
            )}
            <div className="login-divider"><span>or</span></div>
          </div>
        )}

        {/* Email/Password form */}
        <form className="login-form" onSubmit={handleEmailSubmit}>
          {mode === "signup" && (
            <input
              className="login-input"
              type="text"
              placeholder="Your name (optional)"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          )}
          <input
            className="login-input"
            type="email"
            placeholder="Email address"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoFocus
          />
          <input
            className="login-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={6}
          />
          {error && <p className="login-error">{error}</p>}
          <button className="login-btn login-btn--primary" type="submit" disabled={loading}>
            {loading ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="login-switch">
          {mode === "login" ? (
            <>No account? <button onClick={() => { setMode("signup"); setError(""); }}>Sign up</button></>
          ) : (
            <>Already have an account? <button onClick={() => { setMode("login"); setError(""); }}>Sign in</button></>
          )}
        </p>

        <p className="login-skip">
          <button onClick={onSkip}>Continue without signing in</button>
        </p>
      </div>
    </div>
  );
}
