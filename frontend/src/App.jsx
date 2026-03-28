import { useCallback, useEffect, useRef, useState } from "react";
import {
  addSessionMessage,
  createSession,
  deleteSession,
  getChatModels,
  getCurrentUser,
  getHealth,
  getSession,
  getSessions,
  logout as apiLogout,
  postChat,
  setAuthToken,
  updateSessionTitle,
} from "./api";
import Chat from "./components/Chat";
import LoginModal from "./components/LoginModal";
import Sidebar from "./components/Sidebar";
import Models from "./pages/Models";
import Settings from "./pages/Settings";

const HEALTH_POLL_MS = 10000;
const SESSION_POLL_MS = 15000;
const SESSION_KEY = "clawhelm_active_session";
const MODEL_KEY = "clawhelm_selected_model";

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

function restoreMessages(data) {
  if (!data?.messages?.length) return [];
  return data.messages.map((m) => {
    let meta = null;
    if (m.meta) {
      try { meta = typeof m.meta === "string" ? JSON.parse(m.meta) : m.meta; } catch {}
    }
    return createMessage(`restored-${m.id}`, m.role, m.content, meta);
  });
}

export default function App() {
  const iconSrc = `${import.meta.env.BASE_URL}clawhelm-icon.svg`;
  const [messages, setMessages] = useState([]);
  const [pendingChat, setPendingChat] = useState(false);
  const [chatError, setChatError] = useState("");
  const [health, setHealth] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [authCheckDone, setAuthCheckDone] = useState(false);
  const [hasOfflineKey, setHasOfflineKey] = useState(false);
  const [authError, setAuthError] = useState("");

  // Sidebar & session state — restore activeSessionId from localStorage
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(() => {
    try { return localStorage.getItem(SESSION_KEY) || null; } catch { return null; }
  });
  const [loadingSessions, setLoadingSessions] = useState(false);

  // Model selector state
  const [chatModels, setChatModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(() => {
    try { return localStorage.getItem(MODEL_KEY) || "auto"; } catch { return "auto"; }
  });
  const [showModelsPage, setShowModelsPage] = useState(false);

  const pendingRef = useRef(false);
  const messagesRef = useRef([]);

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Fetch available models on mount
  useEffect(() => {
    getChatModels().then(setChatModels).catch(() => {});
  }, []);

  // Persist selectedModel to localStorage
  useEffect(() => {
    try { localStorage.setItem(MODEL_KEY, selectedModel); } catch {}
  }, [selectedModel]);

  // Persist activeSessionId to localStorage
  useEffect(() => {
    try {
      if (activeSessionId) {
        localStorage.setItem(SESSION_KEY, activeSessionId);
      } else {
        localStorage.removeItem(SESSION_KEY);
      }
    } catch {}
  }, [activeSessionId]);

  // Check authentication on mount — handles both OAuth callback and normal load
  useEffect(() => {
    let active = true;

    async function initAuth() {
      // Step 1: check for OAuth callback params FIRST
      const params = new URLSearchParams(window.location.search);
      const oauthToken = params.get("auth_token");
      if (oauthToken) {
        setAuthToken(oauthToken);
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (params.has("auth_error")) {
        const error = params.get("auth_error");
        if (active) setAuthError(error);
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      // Step 2: now check the current user (token is already saved if OAuth)
      try {
        const user = await getCurrentUser();
        if (!active) return;
        if (user) {
          setCurrentUser(user);
          setShowLoginModal(false);
        } else {
          const hasKey = localStorage.getItem("openrouter_api_key");
          setHasOfflineKey(!!hasKey);
          setShowLoginModal(!hasKey);
        }
      } catch (err) {
        console.log("Auth check error:", err);
        if (!active) return;
        const hasKey = localStorage.getItem("openrouter_api_key");
        setHasOfflineKey(!!hasKey);
        setShowLoginModal(!hasKey);
      } finally {
        if (active) setAuthCheckDone(true);
      }
    }

    initAuth();
    return () => { active = false; };
  }, []);

  // Load sessions when user logs in, and restore active session
  useEffect(() => {
    if (!currentUser) {
      setSessions([]);
      return;
    }

    let active = true;
    async function loadAndRestore() {
      try {
        setLoadingSessions(true);
        const list = await getSessions();
        if (!active) return;
        setSessions(list);

        // Restore the active session's messages if we have one saved
        const savedId = activeSessionId;
        if (savedId) {
          const exists = list.some((s) => s.id === savedId);
          if (exists) {
            try {
              const data = await getSession(savedId);
              if (active) {
                const restored = restoreMessages(data);
                if (restored.length > 0) {
                  setMessages(restored);
                }
              }
            } catch (err) {
              console.error("Failed to restore session:", err);
              if (active) setActiveSessionId(null);
            }
          } else {
            // Session no longer exists
            if (active) setActiveSessionId(null);
          }
        }
      } catch (err) {
        console.error("Failed to load sessions:", err);
      } finally {
        if (active) setLoadingSessions(false);
      }
    }

    loadAndRestore();
    return () => { active = false; };
  }, [currentUser]);

  // Refresh sessions list periodically and when sidebar opens
  const refreshSessions = useCallback(async () => {
    if (!currentUser) return;
    try {
      const list = await getSessions();
      setSessions(list);
    } catch {}
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const id = setInterval(refreshSessions, SESSION_POLL_MS);
    return () => clearInterval(id);
  }, [currentUser, refreshSessions]);

  // Also refresh when sidebar opens
  useEffect(() => {
    if (sidebarOpen && currentUser) {
      refreshSessions();
    }
  }, [sidebarOpen, currentUser, refreshSessions]);

  // Poll health to know if backend is up
  useEffect(() => {
    let active = true;
    async function check() {
      try {
        const h = await getHealth();
        if (!active) return;
        setHealth(h);
      } catch { /* backend down — non-fatal */ }
    }
    check();
    const id = setInterval(() => check().catch(() => {}), HEALTH_POLL_MS);
    return () => { active = false; clearInterval(id); };
  }, []);

  async function generateAndSetTitle(sessionId, userMessage, assistantMessage) {
    try {
      const titleResponse = await postChat([
        { role: "user", content: userMessage },
        { role: "assistant", content: assistantMessage },
        { role: "user", content: "Generate a short title (3-5 words max) summarizing this conversation. Reply with ONLY the title text, no quotes, no punctuation." },
      ]);
      let title = normalizeAssistantContent(titleResponse).trim().replace(/^["']+|["']+$/g, "");
      if (title && title.length < 80 && title !== "No response received.") {
        await updateSessionTitle(sessionId, title);
        setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title } : s)));
      }
    } catch (err) {
      console.error("Failed to generate session title:", err);
    }
  }

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
    const isNewSession = currentUser && !sessionId;
    if (isNewSession) {
      try {
        const title = prompt.length > 60 ? prompt.slice(0, 57) + "..." : prompt;
        const session = await createSession(title);
        sessionId = session.id;
        setActiveSessionId(sessionId);
        setSessions((prev) => [session, ...prev]);
      } catch (err) {
        console.error("Failed to create session:", err);
      }
    }

    // Save user message to session
    if (currentUser && sessionId) {
      try {
        await addSessionMessage(sessionId, "user", prompt);
      } catch (err) {
        console.error("Failed to save user message:", err);
      }
    }

    try {
      const response = await postChat(
        next.map((m) => ({ role: m.role, content: m.content })),
        { model: selectedModel },
      );
      const content = normalizeAssistantContent(response);
      const meta = extractMeta(response);
      setMessages((cur) => [...cur, createMessage(assistantId, "assistant", content, meta)]);

      // Save assistant message to session
      if (currentUser && sessionId) {
        try {
          await addSessionMessage(sessionId, "assistant", content, meta);
        } catch (err) {
          console.error("Failed to save assistant message:", err);
        }
        // Auto-generate title for new sessions
        if (isNewSession) {
          generateAndSetTitle(sessionId, prompt, content);
        }
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
      setMessages(restoreMessages(data));
    } catch (err) {
      console.error("Failed to load session:", err);
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
      console.error("Failed to delete session:", err);
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
            <img className="app-header__icon" src={iconSrc} alt="ClawHelm" />
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
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M3 5h4m6 0h4M3 10h10m4 0h0M3 15h2m6 0h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="10" cy="5" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
              <circle cx="16" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
              <circle cx="8" cy="15" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
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
          models={chatModels}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          onShowAllModels={() => setShowModelsPage(true)}
        />
      </main>

      <LoginModal
        isOpen={showLoginModal}
        onLoginSuccess={handleLoginSuccess}
        onSkip={() => setShowLoginModal(false)}
        authError={authError}
      />

      {showModelsPage ? (
        <div className="modal-overlay" onClick={() => setShowModelsPage(false)}>
          <div className="modal-card modal-card--wide" onClick={(e) => e.stopPropagation()}>
            <Models
              models={chatModels}
              selectedModel={selectedModel}
              onModelChange={(id) => { setSelectedModel(id); setShowModelsPage(false); }}
              onClose={() => setShowModelsPage(false)}
            />
          </div>
        </div>
      ) : null}

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
              <Settings health={health} currentUser={currentUser} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
