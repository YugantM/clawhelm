import { useEffect, useMemo, useState } from "react";
import { getLogs, getStats, postChat } from "./api";
import Metrics from "./components/Metrics";
import { DEMO_MODE } from "./demoData";
import ChatPage from "./pages/ChatPage";
import Dashboard from "./pages/Dashboard";
import Logs from "./pages/Logs";
import Scoring from "./pages/Scoring";

const REFRESH_INTERVAL_MS = 4000;
const TABS = ["Chat", "Dashboard", "Logs", "Scoring"];

function getTabFromHash() {
  const hashValue = window.location.hash.replace(/^#/, "").trim();
  return TABS.includes(hashValue) ? hashValue : "Chat";
}

function isDemoModeEnabled() {
  return new URLSearchParams(window.location.search).get("demo") === "1";
}

function getDemoMessages() {
  const demoInsight = {
    id: -1,
    model_display_name: "openrouter/free -> openai/gpt-oss-120b:free",
    actual_model: "openai/gpt-oss-120b:free",
    selected_model: "openrouter/free",
    provider: "openrouter",
    routing_reason: "selected based on performance score",
    routing_score: 0.821,
    latency: 2.2201,
    total_tokens: 124,
    estimated_cost: 0,
    fallback_used: false,
  };

  return [
    createMessage("demo-user-1", "user", "Plan a suspiciously over-engineered birthday party for a cat named Kernel."),
    createMessage(
      "demo-assistant-1",
      "assistant",
      "Kernel deserves a launch sequence, not a party. Start with a cardboard mission control wall, issue every guest a badge with a fake systems title, and schedule the cake reveal as a 'critical deployment window.' Add laser-pointer threat drills, tuna can towers as centerpieces, and a dramatic countdown before the cat ignores all of it and sits in the shipping box.",
      demoInsight,
    ),
    createMessage("demo-user-2", "user", "Give me a tagline for the invitation."),
    createMessage(
      "demo-assistant-2",
      "assistant",
      "\"ClawHelm presents: Kernel One. All systems nominal. Treats mandatory.\"",
      demoInsight,
    ),
  ];
}

function createMessage(id, role, content, insight = null) {
  return { id, role, content, insight };
}

function normalizeAssistantContent(response, latestInsight) {
  const errorMessage = response?.error?.message || response?.detail?.error?.message || response?.detail?.message;
  if (typeof errorMessage === "string" && errorMessage.trim()) {
    return errorMessage;
  }

  const content = response?.choices?.[0]?.message?.content;
  const fallbackText = response?.choices?.[0]?.text || response?.output_text || response?.raw_text;

  if (typeof content === "string" && content.trim()) {
    return content;
  }

  if (typeof fallbackText === "string" && fallbackText.trim()) {
    return fallbackText;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
    if (text.trim()) {
      return text;
    }
  }

  if (content && typeof content === "object") {
    try {
      const serialized = JSON.stringify(content, null, 2);
      if (serialized.trim()) {
        return serialized;
      }
    } catch {
      // ignore and fall through to log-based fallback
    }
  }

  if (typeof latestInsight?.response === "string" && latestInsight.response.trim()) {
    return latestInsight.response;
  }

  return "No assistant content returned.";
}

async function waitForLatestLog(previousTopLogId, retries = 8, delayMs = 350) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    let logsData = [];
    try {
      logsData = await getLogs();
    } catch {
      logsData = [];
    }
    const latestLog = logsData[0] || null;

    if (latestLog && latestLog.id !== previousTopLogId) {
      return logsData;
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, delayMs);
    });
  }

  return getLogs();
}

export default function App() {
  const iconSrc = `${import.meta.env.BASE_URL}clawhelm-icon.svg`;
  const demoMode = isDemoModeEnabled();
  const [activeTab, setActiveTab] = useState(getTabFromHash);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [messages, setMessages] = useState(() => (demoMode ? getDemoMessages() : []));
  const [selectedInsightId, setSelectedInsightId] = useState(() => (demoMode ? -1 : null));
  const [loading, setLoading] = useState(true);
  const [pendingChat, setPendingChat] = useState(false);
  const [error, setError] = useState("");
  const [systemWarning, setSystemWarning] = useState("");
  const [pendingPrompt, setPendingPrompt] = useState(null);
  const [pendingAssistantId, setPendingAssistantId] = useState(null);

  async function refreshData() {
    const [logsData, statsData] = await Promise.all([getLogs(), getStats()]);
    setLogs(logsData);
    setStats(statsData);
    setSystemWarning("");
    return { logsData, statsData };
  }

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [logsData, statsData] = await Promise.all([getLogs(), getStats()]);
        if (!active) return;
        setLogs(logsData);
        setStats(statsData);
        setSystemWarning("");
      } catch (err) {
        if (!active) return;
        setSystemWarning(err.message || "Live metrics temporarily unavailable");
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    const intervalId = window.setInterval(() => {
      load().catch(() => {});
    }, REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    function syncTabFromHash() {
      setActiveTab(getTabFromHash());
    }

    window.addEventListener("hashchange", syncTabFromHash);
    return () => {
      window.removeEventListener("hashchange", syncTabFromHash);
    };
  }, []);

  useEffect(() => {
    if (!pendingPrompt || !pendingAssistantId || logs.length === 0) {
      return;
    }

    const latestInsight = logs[0];
    const loggedPrompt = latestInsight?.prompt || "";
    if (!loggedPrompt.includes(pendingPrompt)) {
      return;
    }

    const resolvedAssistantContent = latestInsight.response || "No assistant content returned.";
    setMessages((current) => {
      const existingAssistant = current.find((message) => message.id === pendingAssistantId);
      if (existingAssistant) {
        return current.map((message) =>
          message.id === pendingAssistantId
            ? { ...message, content: resolvedAssistantContent, insight: latestInsight }
            : message,
        );
      }

      return [...current, createMessage(pendingAssistantId, "assistant", resolvedAssistantContent, latestInsight)];
    });

    setSelectedInsightId(latestInsight.id);
    setPendingPrompt(null);
    setPendingAssistantId(null);
  }, [logs, pendingAssistantId, pendingPrompt]);

  async function handleSend(prompt) {
    const previousTopLogId = logs[0]?.id ?? null;
    const userMessage = createMessage(`user-${Date.now()}`, "user", prompt);
    const assistantMessageId = `assistant-${Date.now()}`;
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setPendingChat(true);
    setError("");
    setPendingPrompt(prompt);
    setPendingAssistantId(assistantMessageId);

    try {
      const response = await postChat(nextMessages.map((message) => ({ role: message.role, content: message.content })));
      const optimisticAssistantContent = normalizeAssistantContent(response, null);
      setMessages((current) => [
        ...current,
        createMessage(assistantMessageId, "assistant", optimisticAssistantContent, null),
      ]);

      try {
        const logsData = await waitForLatestLog(previousTopLogId);
        setLogs(logsData);
        try {
          const statsData = await getStats();
          setStats(statsData);
          setSystemWarning("");
        } catch (statsError) {
          setSystemWarning(statsError.message || "Metrics refresh delayed");
        }
        const latestInsight = logsData[0] || null;
        const resolvedAssistantContent = normalizeAssistantContent(response, latestInsight);

        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: resolvedAssistantContent, insight: latestInsight }
              : message,
          ),
        );

        if (latestInsight) {
          setSelectedInsightId(latestInsight.id);
        }
        setPendingPrompt(null);
        setPendingAssistantId(null);
      } catch (refreshError) {
        setSystemWarning(refreshError.message || "Log refresh delayed");
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  content: normalizeAssistantContent(response, logs[0] || null),
                }
              : message,
          ),
        );
      }
    } catch (err) {
      const errorPayload = err?.payload || null;
      const assistantErrorContent = normalizeAssistantContent(errorPayload, logs[0] || null);

      setMessages((current) => [
        ...current,
        createMessage(assistantMessageId, "assistant", assistantErrorContent, null),
      ]);

      try {
        const logsData = await waitForLatestLog(previousTopLogId);
        setLogs(logsData);

        const latestInsight = logsData[0] || null;
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  content: normalizeAssistantContent(errorPayload || { raw_text: assistantErrorContent }, latestInsight),
                  insight: latestInsight,
                }
              : message,
          ),
        );

        if (latestInsight) {
          setSelectedInsightId(latestInsight.id);
        }

        try {
          const statsData = await getStats();
          setStats(statsData);
          setSystemWarning("");
        } catch (statsError) {
          setSystemWarning(statsError.message || "Metrics refresh delayed");
        }
      } catch {
        // Keep the assistant error bubble even if logs lag behind.
      }

      if (errorPayload) {
        setError("");
      } else {
        setError(err.message || "Failed to send chat request");
      }
      setPendingPrompt(null);
      setPendingAssistantId(null);
    } finally {
      setPendingChat(false);
    }
  }

  const selectedInsight = useMemo(
    () => logs.find((entry) => entry.id === selectedInsightId) || messages.find((message) => message.insight?.id === selectedInsightId)?.insight || null,
    [logs, messages, selectedInsightId],
  );

  let page = null;
  if (activeTab === "Chat") {
    page = (
      <ChatPage
        messages={messages}
        pending={pendingChat}
        onSend={handleSend}
        selectedInsightId={selectedInsightId}
        onSelectInsight={setSelectedInsightId}
        selectedInsight={selectedInsight}
      />
    );
  } else if (activeTab === "Dashboard") {
    page = <Dashboard stats={stats} />;
  } else if (activeTab === "Scoring") {
    page = <Scoring stats={stats} />;
  } else {
    page = <Logs logs={logs} loading={loading} />;
  }

  return (
    <div className="app-shell">
      <header className="topbar panel">
        <div className="brand-block">
          <div className="brand-lockup">
            <img className="brand-lockup__icon" src={iconSrc} alt="" aria-hidden="true" />
            <div className="brand-lockup__text">
              <strong>ClawHelm</strong>
              <span>Adaptive LLM routing dashboard</span>
            </div>
          </div>
        </div>
        <div className="topbar__status">
          <span
            className={`status-pill ${
              error ? "status-pill--danger" : DEMO_MODE ? "status-pill--demo" : "status-pill--live"
            }`}
          >
            {error ? "Chat error" : DEMO_MODE ? "Demo" : "Live"}
          </span>
        </div>
      </header>

      <nav className="tabs" aria-label="Primary">
        <div className="tabs__rail">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`tab-button ${activeTab === tab ? "tab-button--active" : ""}`}
              onClick={() => {
                setActiveTab(tab);
                window.location.hash = tab;
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </nav>

      {error ? <div className="error-banner">{error}</div> : null}
      {!error && DEMO_MODE ? (
        <div className="warning-banner">
          Public demo mode. This site uses bundled sample data and does not expose private logs or live backend traffic.
        </div>
      ) : null}
      {!error && systemWarning ? <div className="warning-banner">{systemWarning}</div> : null}

      {activeTab !== "Logs" ? <Metrics stats={stats} /> : null}
      {page}
    </div>
  );
}
