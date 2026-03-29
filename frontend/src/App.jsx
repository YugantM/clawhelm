import { useCallback, useEffect, useRef, useState } from "react";
import {
  addSessionMessage,
  createSession,
  deleteSession,
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
import Admin from "./pages/Admin";

const HEALTH_POLL_MS = 10000;
const SESSION_POLL_MS = 15000;
const SESSION_KEY = "clawhelm_active_session";
const GUEST_MESSAGES_KEY = "clawhelm_guest_messages";

function saveGuestMessages(messages) {
  try {
    const slim = messages.map((m) => ({ id: m.id, role: m.role, content: m.content, meta: m.meta }));
    localStorage.setItem(GUEST_MESSAGES_KEY, JSON.stringify(slim));
  } catch {}
}

function loadGuestMessages() {
  try {
    const raw = localStorage.getItem(GUEST_MESSAGES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((m) => createMessage(m.id || `restored-${Date.now()}`, m.role, m.content, m.meta || null));
  } catch { return []; }
}

function clearGuestMessages() {
  try { localStorage.removeItem(GUEST_MESSAGES_KEY); } catch {}
}

function createMessageId(prefix) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function stripIdentityPrefix(content) {
  if (typeof content !== "string") return content;
  // Remove any leading line(s) where the model introduces itself as selected by ClawHelm
  return content
    .replace(/^.*?(?:i['']?m|i am|selected by)\s+(?:clawhelm|claw\s*helm)[^\n]*/gim, "")
    .replace(/^\s+/, "");
}

function createMessage(id, role, content, meta = null) {
  return { id, role, content, meta };
}

function normalizeAssistantContent(response) {
  const content = response?.choices?.[0]?.message?.content;
  const fallbackText = response?.choices?.[0]?.text || response?.output_text || response?.raw_text;

  if (typeof content === "string" && content.trim()) return content;
  if (typeof fallbackText === "string" && fallbackText.trim()) return fallbackText;

  if (Array.isArray(content)) {
    const text = content.map((item) => (typeof item === "string" ? item : item?.text || "")).filter(Boolean).join("\n");
    if (text.trim()) return text;
  }

  const errorMessage = response?.error?.message || response?.detail?.error?.message || response?.detail?.message;
  if (typeof errorMessage === "string" && errorMessage.trim()) return null;

  return null;
}

function extractMeta(response) {
  return {
    actual_model: response?.actual_model || response?.model || null,
    display_name: response?.display_name || null,
    provider: response?.provider || null,
    latency: typeof response?.latency === "number" ? response.latency : null,
    total_tokens: response?.usage?.total_tokens ?? null,
    fallback_used: Boolean(response?.fallback_used),
    runner_up_avg_latency: typeof response?.runner_up_avg_latency === "number" ? response.runner_up_avg_latency : null,
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
  const [messages, setMessages] = useState([]);
  const [pendingChat, setPendingChat] = useState(false);
  const [chatError, setChatError] = useState("");
  const [health, setHealth] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [authCheckDone, setAuthCheckDone] = useState(false);
  const [authError, setAuthError] = useState("");
  const [showAdmin, setShowAdmin] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(() => {
    try { return localStorage.getItem(SESSION_KEY) || null; } catch { return null; }
  });

  const pendingRef = useRef(false);
  const messagesRef = useRef([]);

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    try {
      if (activeSessionId) {
        localStorage.setItem(SESSION_KEY, activeSessionId);
      } else {
        localStorage.removeItem(SESSION_KEY);
      }
    } catch {}
  }, [activeSessionId]);

  useEffect(() => {
    let active = true;
    async function initAuth() {
      const params = new URLSearchParams(window.location.search);
      const oauthToken = params.get("auth_token");
      if (oauthToken) {
        setAuthToken(oauthToken);
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (params.has("auth_error")) {
        if (active) setAuthError(params.get("auth_error"));
        window.history.replaceState({}, document.title, window.location.pathname);
      }
      try {
        const user = await getCurrentUser();
        if (!active) return;
        if (user) {
          setCurrentUser(user);
          setShowLoginModal(false);
        } else {
          setShowLoginModal(true);
        }
      } catch {
        if (!active) return;
        setShowLoginModal(true);
      } finally {
        if (active) setAuthCheckDone(true);
      }
    }
    initAuth();
    return () => { active = false; };
  }, []);

  // Restore guest messages on load when not signed in
  useEffect(() => {
    if (!authCheckDone) return;
    if (!currentUser && messages.length === 0) {
      const restored = loadGuestMessages();
      if (restored.length > 0) setMessages(restored);
    }
    if (currentUser) clearGuestMessages();
  }, [authCheckDone, currentUser]);

  useEffect(() => {
    if (!currentUser) { setSessions([]); return; }
    let active = true;
    async function loadAndRestore() {
      try {
        const list = await getSessions();
        if (!active) return;
        setSessions(list);
        const savedId = activeSessionId;
        if (savedId) {
          const exists = list.some((s) => s.id === savedId);
          if (exists) {
            try {
              const data = await getSession(savedId);
              if (active) {
                const restored = restoreMessages(data);
                if (restored.length > 0) setMessages(restored);
              }
            } catch { if (active) setActiveSessionId(null); }
          } else {
            if (active) setActiveSessionId(null);
          }
        }
      } catch {}
    }
    loadAndRestore();
    return () => { active = false; };
  }, [currentUser]);

  const refreshSessions = useCallback(async () => {
    if (!currentUser) return;
    try { setSessions(await getSessions()); } catch {}
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const id = setInterval(refreshSessions, SESSION_POLL_MS);
    return () => clearInterval(id);
  }, [currentUser, refreshSessions]);

  useEffect(() => {
    if (sidebarOpen && currentUser) refreshSessions();
  }, [sidebarOpen, currentUser, refreshSessions]);

  useEffect(() => {
    let active = true;
    async function check() {
      try {
        const h = await getHealth();
        if (active) setHealth(h);
      } catch {}
    }
    check();
    const id = setInterval(() => check().catch(() => {}), HEALTH_POLL_MS);
    return () => { active = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "t") {
        e.preventDefault();
        handleNewChat();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "a") {
        e.preventDefault();
        setShowAdmin(!showAdmin);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showAdmin]);

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
    } catch {}
  }

  async function handleSend(prompt) {
    if (pendingRef.current) return;
    pendingRef.current = true;

    const userMsg = createMessage(createMessageId("u"), "user", prompt);
    const assistantId = createMessageId("a");
    const next = [...messagesRef.current, userMsg];
    setMessages(next);
    if (!currentUser) saveGuestMessages(next);
    setPendingChat(true);
    setChatError("");

    let sessionId = activeSessionId;
    const isNewSession = currentUser && !sessionId;
    if (isNewSession) {
      try {
        const title = prompt.length > 60 ? prompt.slice(0, 57) + "..." : prompt;
        const session = await createSession(title);
        sessionId = session.id;
        setActiveSessionId(sessionId);
        setSessions((prev) => [session, ...prev]);
      } catch {}
    }

    if (currentUser && sessionId) {
      try { await addSessionMessage(sessionId, "user", prompt); } catch {}
    }

    try {
      const response = await postChat(
        next.map((m) => ({ role: m.role, content: m.content })),
        { model: "auto" },
      );
      const content = normalizeAssistantContent(response);
      if (!content) {
        const errMsg = response?.error?.message || response?.detail?.message || "Something went wrong. Try again.";
        setChatError(errMsg);
      } else {
        const meta = extractMeta(response);
        const assistantMsg = createMessage(assistantId, "assistant", stripIdentityPrefix(content), meta);
        setMessages((cur) => {
          const updated = [...cur, assistantMsg];
          if (!currentUser) saveGuestMessages(updated);
          return updated;
        });

        if (currentUser && sessionId) {
          try { await addSessionMessage(sessionId, "assistant", content, meta); } catch {}
          if (isNewSession) generateAndSetTitle(sessionId, prompt, content);
        }
      }
    } catch (err) {
      const payload = err?.payload || null;
      const content = normalizeAssistantContent(payload);
      if (content) {
        setMessages((cur) => [...cur, createMessage(assistantId, "assistant", content, extractMeta(payload))]);
      } else {
        setChatError(payload?.error?.message || payload?.detail?.message || err.message || "Request failed");
      }
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
    clearGuestMessages();
  }

  async function handleSelectSession(sessionId) {
    setSidebarOpen(false);
    if (sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    setMessages([]);
    setChatError("");
    try { setMessages(restoreMessages(await getSession(sessionId))); } catch {}
  }

  async function handleDeleteSession(sessionId) {
    try {
      await deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) { setActiveSessionId(null); setMessages([]); }
    } catch {}
  }

  async function handleLogout() {
    try { await apiLogout(); } catch {}
    setCurrentUser(null);
    setMessages([]);
    setActiveSessionId(null);
    setSessions([]);
    setSidebarOpen(false);
  }

  return (
    <div className="app-shell">
      <nav className="left-rail">
        <button type="button" className={`rail-btn${sidebarOpen ? " rail-btn--active" : ""}`} onClick={() => setSidebarOpen(!sidebarOpen)} title="Chat history" aria-label="Chat history">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect x="2" y="3" width="5" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
            <rect x="9" y="3" width="7" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
          </svg>
        </button>
        <button type="button" className="rail-btn" onClick={handleNewChat} title="New chat (Ctrl+T)" aria-label="New chat">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
        <div className="rail-spacer" />
        {currentUser ? (
          <button type="button" className="rail-btn rail-btn--avatar" onClick={() => setSidebarOpen(!sidebarOpen)} title={currentUser.name || "Profile"}>
            {currentUser.avatar_url ? (
              <img className="rail-avatar" src={currentUser.avatar_url} alt="" />
            ) : (
              <span className="rail-avatar rail-avatar--placeholder">
                {(currentUser.name || currentUser.email || "?")[0].toUpperCase()}
              </span>
            )}
          </button>
        ) : (
          <button type="button" className="rail-btn" onClick={() => setShowLoginModal(true)} title="Sign in" aria-label="Sign in">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M3 15.5c0-2.5 2.7-4.5 6-4.5s6 2 6 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </nav>

      <div className="app-shell__main">
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

        {chatError ? (
          <div className="error-banner" onClick={() => setChatError("")} role="alert">
            {chatError}
            <button className="error-banner__dismiss" onClick={() => setChatError("")} aria-label="Dismiss">&times;</button>
          </div>
        ) : null}

        <main className="app-main">
          {showAdmin ? (
            <Admin />
          ) : (
            <Chat
              messages={messages}
              pending={pendingChat}
              onSend={handleSend}
              currentUser={currentUser}
            />
          )}
        </main>

        <LoginModal
          isOpen={showLoginModal}
          onLoginSuccess={(user) => { if (user) setCurrentUser(user); setShowLoginModal(false); setAuthError(""); }}
          onSkip={() => setShowLoginModal(false)}
          authError={authError}
        />
      </div>
    </div>
  );
}
