import { useEffect, useMemo, useRef, useState } from "react";
import {
  addSessionMessage,
  createSession,
  deleteSession,
  getCurrentUser,
  getHealth,
  getProviderConfig,
  getSession,
  getSessions,
  logout as apiLogout,
  postChat,
  setAuthToken,
  updateOpenRouterApiKey,
} from "./api";
import Chat from "./components/Chat";
import LoginModal from "./components/LoginModal";
import Sidebar from "./components/Sidebar";
import Settings from "./pages/Settings";

const HEALTH_POLL_MS = 10000;

function createMessageId(prefix) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function createMessage(id, role, content, meta = null) {
  return { id, role, content, meta };
}

function normalizeAssistantContent(response) {
  const errorMessage = response?.error?.message || response?.detail?.error?.message || response?.detail?.message;
  if (typeof errorMessage === "string" && errorMessage.trim()) return errorMessage;

  const content = response?.choices?.[0]?.message?.content;
  const fallbackText = response?.choices?.[0]?.text || response?.output_text || response?.raw_text;

  if (typeof content === "string" && content.trim()) return content;
  if (typeof fallbackText === "string" && fallbackText.trim()) return fallbackText;

  if (Array.isArray(content)) {
    const text = content.map((item) => (typeof item === "string" ? item : item?.text || "")).filter(Boolean).join("\n");
    if (text.trim()) return text;
  }

  return "No response received.";
}

function extractMeta(response) {
  return {
    actual_model: response?.actual_model || response?.model || null,
    selected_model: response?.selected_model || null,
    provider: response?.provider || null,
    latency: typeof response?.latency === "number" ? response.latency : null,
    routing_score: typeof response?.routing_score === "number" ? response.routing_score : null,
    total_tokens: response?.usage?.total_tokens ?? null,
    fallback_used: Boolean(response?.fallback_used),
    fallback_from_model: response?.fallback_from_model || null,
    fallback_to_model: response?.fallback_to_model || null,
  };
}

export default function App() {
  const iconSrc = `${import.meta.env.BASE_URL}clawhelm-icon.svg`;
  const [messages, setMessages] = useState([]);
  const [pendingChat, setPendingChat] = useState(false);
  const [chatError, setChatError] = useState("");
  const [health, setHealth] = useState(null);
  const [providerConfig, setProviderConfig] = useState(null);
  const [openrouterDraft, setOpenrouterDraft] = useState("");
  const [savingProviderConfig, setSavingProviderConfig] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [authCheckDone, setAuthCheckDone] = useState(false);
  const [hasOfflineKey, setHasOfflineKey] = useState(false);
  const [authError, setAuthError] = useState("");

  // Sidebar & session state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const pendingRef = useRef(false);
  const messagesRef = useRef([]);

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Check authentication status on mount
  useEffect(() => {
    let active = true;
    async function checkAuth() {
      try {
        const user = await getCurrentUser();
        if (active) {
          if (user) {
            setCurrentUser(user);
            setShowLoginModal(false);
          } else {
            const hasKey = localStorage.getItem("openrouter_api_key");
            setHasOfflineKey(!!hasKey);
            setShowLoginModal(!hasKey);
          }
        }
      } catch (err) {
        console.log("Auth check error:", err);
        const hasKey = localStorage.getItem("openrouter_api_key");
        if (active) {
          setHasOfflineKey(!!hasKey);
          setShowLoginModal(!hasKey);
        }
      } finally {
        if (active) setAuthCheckDone(true);
      }
    }
    checkAuth();
    return () => { active = false; };
  }, []);

  // Check for auth query params (OAuth callback)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("auth_token");
    if (token) {
      setAuthToken(token);
      window.history.replaceState({}, document.title, window.location.pathname);
      setShowLoginModal(false);
      getCurrentUser().then((user) => {
        if (user) setCurrentUser(user);
      });
    } else if (params.has("auth_error")) {
      const error = params.get("auth_error");
      setAuthError(error);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Load sessions when user logs in
  useEffect(() => {
    if (!currentUser) {
      setSessions([]);
      setActiveSessionId(null);
      return;
    }
    loadSessions();
  }, [currentUser]);

  async function loadSessions() {
    try {
      setLoadingSessions(true);
      const list = await getSessions();
      setSessions(list);
    } catch (err) {
      console.log("Failed to load sessions:", err);
    } finally {
      setLoadingSessions(false);
    }
  }

  // Poll health to know if backend is up
  useEffect(() => {
    let active = true;
    async function check() {
      try {
        const [h, p] = await Promise.all([getHealth(), getProviderConfig()]);
        if (!active) return;
        setHealth(h);
        setProviderConfig(p);
      } catch { /* backend down — non-fatal */ }
    }
    check();
    const id = setInterval(() => check().catch(() => {}), HEALTH_POLL_MS);
    return () => { active = false; clearInterval(id); };
  }, []);

  async function handleSend(prompt) {
    if (pendingRef.current) return;
    pendingRef.current = true;

    const userMsg = createMessage(createMessageId("u"), "user", prompt);
    const assistantId = createMessageId("a");
    const next = [...messagesRef.current, userMsg];
    setMessages(next);
    setPendingChat(true);
    setChatError("");

    // Auto-create session for logged-in users on first message
    let sessionId = activeSessionId;
    if (currentUser && !sessionId) {
      try {
        const title = prompt.length > 60 ? prompt.slice(0, 57) + "..." : prompt;
        const session = await createSession(title);
        sessionId = session.id;
        setActiveSessionId(sessionId);
        setSessions((prev) => [session, ...prev]);
      } catch (err) {
        console.log("Failed to create session:", err);
      }
    }

    // Save user message to session
    if (currentUser && sessionId) {
      addSessionMessage(sessionId, "user", prompt).catch(() => {});
    }

    try {
      const response = await postChat(
        next.map((m) => ({ role: m.role, content: m.content })),
      );
      const content = normalizeAssistantContent(response);
      const meta = extractMeta(response);
      setMessages((cur) => [...cur, createMessage(assistantId, "assistant", content, meta)]);

      // Save assistant message to session
      if (currentUser && sessionId) {
        addSessionMessage(sessionId, "assistant", content, meta).catch(() => {});
      }
    } catch (err) {
      const payload = err?.payload || null;
      const content = normalizeAssistantContent(payload || { error: { message: err.message || "Request failed" } });
      const meta = payload ? extractMeta(payload) : null;
      setMessages((cur) => [...cur, createMessage(assistantId, "assistant", content, meta)]);
      if (!payload) setChatError(err.message || "Failed to send");
    } finally {
      pendingRef.current = false;
      setPendingChat(false);
    }
  }

  function handleNewChat() {
    setMessages([]);
    setActiveSessionId(null);
    setChatError("");
    setSidebarOpen(false);
  }

  async function handleSelectSession(sessionId) {
    setSidebarOpen(false);
    if (sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    setMessages([]);
    setChatError("");
    try {
      const data = await getSession(sessionId);
      if (data.messages && data.messages.length > 0) {
        const restored = data.messages.map((m) => {
          let meta = null;
          if (m.meta) {
            try { meta = typeof m.meta === "string" ? JSON.parse(m.meta) : m.meta; } catch {}
          }
          return createMessage(
            `restored-${m.id}`,
            m.role,
            m.content,
            meta,
          );
        });
        setMessages(restored);
      }
    } catch (err) {
      console.log("Failed to load session:", err);
    }
  }

  async function handleDeleteSession(sessionId) {
    try {
      await deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
        setMessages([]);
      }
    } catch (err) {
      console.log("Failed to delete session:", err);
    }
  }

  async function handleLogout() {
    try {
      await apiLogout();
    } catch {}
    setCurrentUser(null);
    setMessages([]);
    setActiveSessionId(null);
    setSessions([]);
    setSidebarOpen(false);
  }

  async function handleSaveOpenrouterKey() {
    setSavingProviderConfig(true);
    setSettingsError("");
    try {
      const nextConfig = await updateOpenRouterApiKey(openrouterDraft);
      const h = await getHealth();
      setProviderConfig(nextConfig);
      setHealth(h);
      setOpenrouterDraft("");
    } catch (err) {
      setSettingsError(err?.payload?.error?.message || err.message || "Failed to save key");
    } finally {
      setSavingProviderConfig(false);
    }
  }

  async function handleClearOpenrouterKey() {
    setSavingProviderConfig(true);
    setSettingsError("");
    try {
      const nextConfig = await updateOpenRouterApiKey("");
      const h = await getHealth();
      setProviderConfig(nextConfig);
      setHealth(h);
      setOpenrouterDraft("");
    } catch (err) {
      setSettingsError(err?.payload?.error?.message || err.message || "Failed to clear key");
    } finally {
      setSavingProviderConfig(false);
    }
  }

  const backendUp = health?.status === "ok";

  function handleLoginSuccess(user) {
    if (user) setCurrentUser(user);
    setShowLoginModal(false);
    setAuthError("");
  }

  return (
    <div className="app-shell">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onDeleteSession={handleDeleteSession}
        currentUser={currentUser}
        onLogout={handleLogout}
        onSignIn={() => { setSidebarOpen(false); setShowLoginModal(true); }}
      />

      <header className="app-header">
        <div className="app-header__left">
          <button type="button" className="icon-button sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle sidebar" title="Chat history">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <div className="app-header__brand">
            <img className="app-header__icon" src={iconSrc} alt="" aria-hidden="true" />
            <strong className="app-header__name">ClawHelm</strong>
          </div>
        </div>

        <button type="button" className="new-chat-button" onClick={handleNewChat}>
          New chat
        </button>

        <div className="app-header__actions">
          {currentUser ? (
            <div className="header-user">
              {currentUser.avatar_url ? (
                <img className="header-user__avatar" src={currentUser.avatar_url} alt="" />
              ) : (
                <div className="header-user__avatar header-user__avatar--placeholder">
                  {(currentUser.name || currentUser.email || "?")[0].toUpperCase()}
                </div>
              )}
            </div>
          ) : (
            <button type="button" className="header-signin-btn" onClick={() => setShowLoginModal(true)}>
              Sign in
            </button>
          )}
          <span className={`status-dot ${backendUp ? "status-dot--live" : "status-dot--off"}`} title={backendUp ? "Connected" : "Offline"} />
          <button type="button" className="icon-button" onClick={() => setShowSettings(true)} aria-label="Settings" title="Settings">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 13a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5"/><path d="M16.47 12.37l.89.52a1 1 0 01.36 1.36l-1 1.74a1 1 0 01-1.36.36l-.89-.52a7.06 7.06 0 01-1.5.87v1.04a1 1 0 01-1 1h-2a1 1 0 01-1-1V16.7a7.06 7.06 0 01-1.5-.87l-.89.52a1 1 0 01-1.36-.36l-1-1.74a1 1 0 01.36-1.36l.89-.52a7.1 7.1 0 010-1.74l-.89-.52a1 1 0 01-.36-1.36l1-1.74a1 1 0 011.36-.36l.89.52a7.06 7.06 0 011.5-.87V3.26a1 1 0 011-1h2a1 1 0 011 1V4.3a7.06 7.06 0 011.5.87l.89-.52a1 1 0 011.36.36l1 1.74a1 1 0 01-.36 1.36l-.89.52a7.1 7.1 0 010 1.74z" stroke="currentColor" strokeWidth="1.5"/></svg>
          </button>
        </div>
      </header>

      {chatError ? <div className="error-banner">{chatError}</div> : null}

      <main className="app-main">
        <Chat
          messages={messages}
          pending={pendingChat}
          onSend={handleSend}
          currentUser={currentUser}
        />
      </main>

      <LoginModal
        isOpen={showLoginModal}
        onLoginSuccess={handleLoginSuccess}
        onSkip={() => setShowLoginModal(false)}
        authError={authError}
      />

      {showSettings ? (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-card__header">
              <h2>Settings</h2>
              <button type="button" className="icon-button" onClick={() => setShowSettings(false)} aria-label="Close">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            </div>
            <div className="modal-card__body">
              <Settings
                health={health}
                providerConfig={providerConfig}
                openrouterDraft={openrouterDraft}
                onOpenrouterDraftChange={setOpenrouterDraft}
                onSaveOpenrouterKey={handleSaveOpenrouterKey}
                onClearOpenrouterKey={handleClearOpenrouterKey}
                savingProviderConfig={savingProviderConfig}
              />
              {settingsError ? <p className="settings-error">{settingsError}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
