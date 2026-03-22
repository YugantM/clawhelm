import { useEffect, useMemo, useState } from "react";
import { getHealth, getLogs, getProviderConfig, getStats, postChat, postChatByok, postCloudChat, updateOpenRouterApiKey } from "./api";
import { DEMO_MODE } from "./demoData";
import ChatPage from "./pages/ChatPage";
import Dashboard from "./pages/Dashboard";
import Logs from "./pages/Logs";
import Scoring from "./pages/Scoring";
import Settings from "./pages/Settings";

const REFRESH_INTERVAL_MS = 4000;
const TABS = ["Chat", "Dashboard", "Logs", "Scoring", "Settings"];
const STORAGE_KEYS = {
  publicMode: "clawhelm_public_mode",
  byokProvider: "clawhelm_byok_provider",
  byokApiKey: "clawhelm_byok_api_key",
  byokModel: "clawhelm_byok_model",
  chatMode: "clawhelm_chat_mode",
  cloudSessionId: "clawhelm_cloud_session_id",
};

function getTabFromHash() {
  const hashValue = window.location.hash.replace(/^#/, "").trim();
  return TABS.includes(hashValue) ? hashValue : "Chat";
}

function getInitialPublicMode() {
  if (!DEMO_MODE || typeof window === "undefined") {
    return "live";
  }

  return window.sessionStorage.getItem(STORAGE_KEYS.publicMode) || "demo";
}

function getInitialByokConfig() {
  if (typeof window === "undefined") {
    return {
      provider: "openrouter",
      apiKey: "",
      model: "openai/gpt-oss-120b:free",
    };
  }

  return {
    provider: window.sessionStorage.getItem(STORAGE_KEYS.byokProvider) || "openrouter",
    apiKey: window.sessionStorage.getItem(STORAGE_KEYS.byokApiKey) || "",
    model: window.sessionStorage.getItem(STORAGE_KEYS.byokModel) || "openai/gpt-oss-120b:free",
  };
}

function createMessage(id, role, content, insight = null) {
  return { id, role, content, insight };
}

function createSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function getInitialChatMode() {
  if (typeof window === "undefined") {
    return "local";
  }
  return window.localStorage.getItem(STORAGE_KEYS.chatMode) || "local";
}

function getInitialCloudSessionId() {
  if (typeof window === "undefined") {
    return createSessionId();
  }
  const existing = window.localStorage.getItem(STORAGE_KEYS.cloudSessionId);
  if (existing) {
    return existing;
  }
  const sessionId = createSessionId();
  window.localStorage.setItem(STORAGE_KEYS.cloudSessionId, sessionId);
  return sessionId;
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
      logsData = await getLogs({ useDemo: false });
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

  return getLogs({ useDemo: false });
}

async function waitForSessionLog(sessionId, previousTopLogId, retries = 8, delayMs = 350) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    let logsData = [];
    try {
      logsData = await getLogs({ useDemo: false });
    } catch {
      logsData = [];
    }

    const matchingLog = logsData.find((entry) => entry.session_id === sessionId && entry.id !== previousTopLogId) || null;
    if (matchingLog) {
      return { logsData, matchingLog };
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, delayMs);
    });
  }

  const logsData = await getLogs({ useDemo: false });
  return {
    logsData,
    matchingLog: logsData.find((entry) => entry.session_id === sessionId && entry.id !== previousTopLogId) || null,
  };
}

function buildByokInsight({ response, provider, model, prompt, startedAt, fallbackUsed = false, statusCode = 200 }) {
  const actualModel = response?.model || model;
  const responseText = normalizeAssistantContent(response, null);
  const totalTokens = response?.usage?.total_tokens ?? null;
  const latencySeconds = Math.max((performance.now() - startedAt) / 1000, 0);

  return {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    original_model: model,
    selected_model: model,
    actual_model: actualModel,
    model_display_name: actualModel !== model ? `${model} -> ${actualModel}` : actualModel,
    provider,
    is_free_model: actualModel.endsWith?.(":free") || model.endsWith?.(":free"),
    model_source: "byok",
    routing_reason: "user supplied api key",
    routing_score: null,
    status_code: statusCode,
    fallback_used: fallbackUsed,
    prompt: JSON.stringify(prompt),
    response: responseText,
    latency: latencySeconds,
    total_tokens: totalTokens,
    estimated_cost: actualModel.endsWith?.(":free") ? 0 : 0,
  };
}

function deriveByokStats(logs) {
  const totalRequests = logs.length;
  const successfulRequests = logs.filter((entry) => (entry.status_code || 0) < 400).length;
  const failedRequests = totalRequests - successfulRequests;
  const fallbackCount = logs.filter((entry) => entry.fallback_used).length;
  const totalLatency = logs.reduce((sum, entry) => sum + (entry.latency || 0), 0);
  const totalEstimatedCost = logs.reduce((sum, entry) => sum + (entry.estimated_cost || 0), 0);
  const requestsByActualModel = {};
  const requestsByProvider = {};
  const performanceByModel = {};

  logs.forEach((entry) => {
    if (entry.actual_model) {
      requestsByActualModel[entry.actual_model] = (requestsByActualModel[entry.actual_model] || 0) + 1;
    }
    if (entry.provider) {
      requestsByProvider[entry.provider] = (requestsByProvider[entry.provider] || 0) + 1;
    }
  });

  Object.keys(requestsByActualModel).forEach((modelId) => {
    const modelLogs = logs.filter((entry) => entry.actual_model === modelId);
    const modelSuccess = modelLogs.filter((entry) => (entry.status_code || 0) < 400).length;
    const avgLatency = modelLogs.reduce((sum, entry) => sum + (entry.latency || 0), 0) / Math.max(modelLogs.length, 1);
    const avgCost = modelLogs.reduce((sum, entry) => sum + (entry.estimated_cost || 0), 0) / Math.max(modelLogs.length, 1);
    performanceByModel[modelId] = {
      success_rate: modelSuccess / Math.max(modelLogs.length, 1),
      avg_latency: avgLatency,
      avg_cost: avgCost,
      latency_score: avgLatency > 0 ? 1 / (1 + avgLatency) : 1,
      cost_score: avgCost > 0 ? 1 / (1 + avgCost) : 1,
      confidence: Math.min(modelLogs.length / 5, 1),
      score: 0.5,
      sample_count: modelLogs.length,
    };
  });

  return {
    total_requests: totalRequests,
    successful_requests: successfulRequests,
    failed_requests: failedRequests,
    fallback_count: fallbackCount,
    avg_latency: totalRequests ? totalLatency / totalRequests : 0,
    total_estimated_cost_usd: totalEstimatedCost,
    free_model_usage_count: logs.filter((entry) => entry.is_free_model).length,
    requests_using_free_models: logs.filter((entry) => entry.is_free_model).length,
    cost_saved_estimate: 0,
    requests_by_actual_model: requestsByActualModel,
    requests_by_provider: requestsByProvider,
    usage_by_provider: requestsByProvider,
    performance_by_model: performanceByModel,
    candidate_scores: Object.entries(performanceByModel).map(([modelId, values], index) => ({
      rank: index + 1,
      model_id: modelId,
      provider: logs.find((entry) => entry.actual_model === modelId)?.provider || "unknown",
      is_free: modelId.endsWith(":free"),
      enabled: true,
      excluded: false,
      exclusion_reason: null,
      ...values,
    })),
  };
}

function buildEffectiveProviderConfig(providerConfig, health) {
  const openrouterConfigured = providerConfig?.providers?.openrouter?.configured ?? Boolean(health?.openrouter_key_configured);

  return {
    settings_path: providerConfig?.settings_path || health?.settings_path || "unknown",
    providers: {
      openrouter: {
        configured: openrouterConfigured,
        source: providerConfig?.providers?.openrouter?.source || (health?.openrouter_key_configured ? "runtime" : "missing"),
        masked_key: providerConfig?.providers?.openrouter?.masked_key || (health?.openrouter_key_configured ? "Configured" : null),
      },
      openai: {
        configured: providerConfig?.providers?.openai?.configured || false,
        source: providerConfig?.providers?.openai?.source || "missing",
        masked_key: providerConfig?.providers?.openai?.masked_key || null,
      },
    },
  };
}

function PublicAccessPanel({ publicMode, onPublicModeChange, byokConfig, onByokConfigChange }) {
  return (
    <section className="access-panel panel">
      <div className="access-panel__header">
        <div>
          <h2>Public access</h2>
          <p>GitHub Pages stays safe by default. Switch to your own key if you want real provider responses in the browser.</p>
        </div>
        <div className="access-toggle" role="tablist" aria-label="Public access mode">
          <button
            type="button"
            className={publicMode === "demo" ? "access-toggle__button access-toggle__button--active" : "access-toggle__button"}
            onClick={() => onPublicModeChange("demo")}
          >
            Demo
          </button>
          <button
            type="button"
            className={publicMode === "byok" ? "access-toggle__button access-toggle__button--active" : "access-toggle__button"}
            onClick={() => onPublicModeChange("byok")}
          >
            Use your own key
          </button>
        </div>
      </div>

      {publicMode === "byok" ? (
        <div className="access-grid">
          <label>
            <span>Provider</span>
            <select
              value={byokConfig.provider}
              onChange={(event) => onByokConfigChange({ provider: event.target.value })}
            >
              <option value="openrouter">OpenRouter</option>
              <option value="openai">OpenAI</option>
            </select>
          </label>
          <label>
            <span>Model</span>
            <input
              type="text"
              value={byokConfig.model}
              onChange={(event) => onByokConfigChange({ model: event.target.value })}
              placeholder="openai/gpt-oss-120b:free"
            />
          </label>
          <label className="access-grid__full">
            <span>API key</span>
            <input
              type="password"
              value={byokConfig.apiKey}
              onChange={(event) => onByokConfigChange({ apiKey: event.target.value })}
              placeholder="Stored only in this browser session"
            />
          </label>
          <p className="access-panel__note">
            Keys stay in sessionStorage for this browser tab session and are sent directly to the provider, not to the ClawHelm demo host.
          </p>
        </div>
      ) : (
        <p className="access-panel__note">Demo mode uses bundled sample data only. No live backend traffic or private logs are exposed.</p>
      )}
    </section>
  );
}

export default function App() {
  const iconSrc = `${import.meta.env.BASE_URL}clawhelm-icon.svg`;
  const [activeTab, setActiveTab] = useState(getTabFromHash);
  const [publicMode, setPublicMode] = useState(getInitialPublicMode);
  const [byokConfig, setByokConfig] = useState(getInitialByokConfig);
  const [chatMode, setChatMode] = useState(getInitialChatMode);
  const [cloudSessionId, setCloudSessionId] = useState(getInitialCloudSessionId);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [health, setHealth] = useState(null);
  const [providerConfig, setProviderConfig] = useState(null);
  const [openrouterDraft, setOpenrouterDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const [selectedInsightId, setSelectedInsightId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pendingChat, setPendingChat] = useState(false);
  const [chatError, setChatError] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [systemWarning, setSystemWarning] = useState("");
  const [savingProviderConfig, setSavingProviderConfig] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState(null);
  const [pendingAssistantId, setPendingAssistantId] = useState(null);

  const useDemoData = DEMO_MODE && publicMode === "demo";
  const useByokMode = DEMO_MODE && publicMode === "byok";

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(STORAGE_KEYS.publicMode, publicMode);
  }, [publicMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEYS.chatMode, chatMode);
  }, [chatMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!cloudSessionId) return;
    window.localStorage.setItem(STORAGE_KEYS.cloudSessionId, cloudSessionId);
  }, [cloudSessionId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(STORAGE_KEYS.byokProvider, byokConfig.provider);
    window.sessionStorage.setItem(STORAGE_KEYS.byokApiKey, byokConfig.apiKey);
    window.sessionStorage.setItem(STORAGE_KEYS.byokModel, byokConfig.model);
  }, [byokConfig]);

  useEffect(() => {
    if (useDemoData) {
      setMessages([]);
      setSelectedInsightId(null);
    }
  }, [useDemoData]);

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
    let active = true;

    async function load() {
      try {
        if (useByokMode) {
          const localStats = deriveByokStats(logs);
          if (!active) return;
          setStats(localStats);
          setHealth({
            status: "ok",
            service: "clawhelm-byok",
            provider_base_url: byokConfig.provider === "openrouter" ? "https://openrouter.ai/api/v1" : "https://api.openai.com",
            db_path: "session://browser-memory",
          });
          setSystemWarning("");
          return;
        }

        const useDemo = useDemoData;
        const [logsData, statsData, healthData, providerConfigData] = await Promise.all([
          getLogs({ useDemo }),
          getStats({ useDemo }),
          getHealth({ useDemo }),
          getProviderConfig({ useDemo }),
        ]);
        if (!active) return;
        setLogs(logsData);
        setStats(statsData);
        setHealth(healthData);
        setProviderConfig(providerConfigData);
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
  }, [byokConfig.provider, logs, useByokMode, useDemoData]);

  useEffect(() => {
    if (!pendingPrompt || !pendingAssistantId || logs.length === 0 || useByokMode || useDemoData) {
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
  }, [logs, pendingAssistantId, pendingPrompt, useByokMode, useDemoData]);

  async function handleSend(prompt) {
    const previousTopLogId = logs[0]?.id ?? null;
    const userMessage = createMessage(`user-${Date.now()}`, "user", prompt);
    const assistantMessageId = `assistant-${Date.now()}`;
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setPendingChat(true);
    setChatError("");
    setPendingPrompt(prompt);
    setPendingAssistantId(assistantMessageId);

    try {
      if (useByokMode) {
        const startedAt = performance.now();
        const response = await postChatByok({
          provider: byokConfig.provider,
          apiKey: byokConfig.apiKey,
          model: byokConfig.model,
          messages: nextMessages.map((message) => ({ role: message.role, content: message.content })),
        });
        const insight = buildByokInsight({
          response,
          provider: byokConfig.provider,
          model: byokConfig.model,
          prompt: nextMessages.map((message) => ({ role: message.role, content: message.content })),
          startedAt,
        });
        const assistantContent = normalizeAssistantContent(response, insight);
        setMessages((current) => [...current, createMessage(assistantMessageId, "assistant", assistantContent, insight)]);
        setLogs((current) => [insight, ...current].slice(0, 50));
        setSelectedInsightId(insight.id);
        setPendingPrompt(null);
        setPendingAssistantId(null);
        return;
      }

      if (!useDemoData && chatMode === "cloud") {
        const sessionId = cloudSessionId || createSessionId();
        if (sessionId !== cloudSessionId) {
          setCloudSessionId(sessionId);
        }

        const response = await postCloudChat({ message: prompt, sessionId }, { useDemo: false });
        const optimisticAssistantContent = normalizeAssistantContent(response, null);
        setMessages((current) => [...current, createMessage(assistantMessageId, "assistant", optimisticAssistantContent, null)]);

        try {
          const { logsData, matchingLog } = await waitForSessionLog(sessionId, previousTopLogId);
          setLogs(logsData);
          try {
            const [statsData, healthData] = await Promise.all([getStats({ useDemo: false }), getHealth({ useDemo: false })]);
            setStats(statsData);
            setHealth(healthData);
            setSystemWarning("");
          } catch (statsError) {
            setSystemWarning(statsError.message || "Metrics refresh delayed");
          }

          const latestInsight = matchingLog || null;
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
          setSystemWarning(refreshError.message || "Cloud log refresh delayed");
        }

        return;
      }

      const response = await postChat(nextMessages.map((message) => ({ role: message.role, content: message.content })), {
        useDemo: useDemoData,
      });
      const optimisticAssistantContent = normalizeAssistantContent(response, null);
      setMessages((current) => [...current, createMessage(assistantMessageId, "assistant", optimisticAssistantContent, null)]);

      if (useDemoData) {
        const insight = {
          id: Date.now(),
          timestamp: new Date().toISOString(),
          selected_model: response.model,
          actual_model: response.model,
          model_display_name: response.model,
          provider: "demo",
          routing_reason: "bundled sample response",
          latency: 0,
          routing_score: null,
          total_tokens: response?.usage?.total_tokens ?? null,
          estimated_cost: 0,
          fallback_used: false,
          response: optimisticAssistantContent,
        };
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId ? { ...message, content: optimisticAssistantContent, insight } : message,
          ),
        );
        setSelectedInsightId(insight.id);
        setPendingPrompt(null);
        setPendingAssistantId(null);
        return;
      }

      try {
        const logsData = await waitForLatestLog(previousTopLogId);
        setLogs(logsData);
        try {
          const [statsData, healthData] = await Promise.all([getStats({ useDemo: false }), getHealth({ useDemo: false })]);
          setStats(statsData);
          setHealth(healthData);
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

      if (useByokMode) {
        const startedAt = performance.now();
        const insight = buildByokInsight({
          response: errorPayload || { raw_text: assistantErrorContent },
          provider: byokConfig.provider,
          model: byokConfig.model,
          prompt: nextMessages.map((message) => ({ role: message.role, content: message.content })),
          startedAt,
          statusCode: err?.status || 500,
        });
        setMessages((current) => [...current, createMessage(assistantMessageId, "assistant", assistantErrorContent, insight)]);
        setLogs((current) => [insight, ...current].slice(0, 50));
        setSelectedInsightId(insight.id);
      } else if (chatMode === "cloud") {
        setMessages((current) => [...current, createMessage(assistantMessageId, "assistant", assistantErrorContent, null)]);
        try {
          const { logsData, matchingLog } = await waitForSessionLog(cloudSessionId, previousTopLogId);
          setLogs(logsData);
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    content: normalizeAssistantContent(errorPayload || { raw_text: assistantErrorContent }, matchingLog),
                    insight: matchingLog,
                  }
                : message,
            ),
          );
          if (matchingLog) {
            setSelectedInsightId(matchingLog.id);
          }
        } catch {
          // Keep assistant error bubble visible even if logs lag behind.
        }
      } else {
        setMessages((current) => [...current, createMessage(assistantMessageId, "assistant", assistantErrorContent, null)]);

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
            const [statsData, healthData] = await Promise.all([getStats({ useDemo: false }), getHealth({ useDemo: false })]);
            setStats(statsData);
            setHealth(healthData);
            setSystemWarning("");
          } catch (statsError) {
            setSystemWarning(statsError.message || "Metrics refresh delayed");
          }
        } catch {
          // Keep the assistant error bubble even if logs lag behind.
        }
      }

      if (errorPayload) {
        setChatError("");
      } else {
        setChatError(err.message || "Failed to send chat request");
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
  const effectiveProviderConfig = useMemo(() => buildEffectiveProviderConfig(providerConfig, health), [providerConfig, health]);
  const currentPageError = activeTab === "Chat" ? chatError : activeTab === "Settings" ? settingsError : "";
  const currentStatusClass = currentPageError
    ? "status-pill--danger"
    : useByokMode
      ? "status-pill--byok"
      : useDemoData
        ? "status-pill--demo"
        : "status-pill--live";
  const currentStatusLabel = currentPageError
    ? activeTab === "Settings"
      ? "Settings error"
      : "Chat error"
    : useByokMode
      ? "BYOK"
      : useDemoData
        ? "Demo"
        : "Live";

  async function handleSaveOpenrouterKey() {
    setSavingProviderConfig(true);
    setSettingsError("");
    try {
      const nextConfig = await updateOpenRouterApiKey(openrouterDraft, { useDemo: false });
      const [healthData, statsData] = await Promise.all([getHealth({ useDemo: false }), getStats({ useDemo: false })]);
      setProviderConfig(nextConfig);
      setHealth(healthData);
      setStats(statsData);
      setOpenrouterDraft("");
      setSystemWarning("");
    } catch (err) {
      setSettingsError(err?.payload?.error?.message || err.message || "Failed to save OpenRouter key");
    } finally {
      setSavingProviderConfig(false);
    }
  }

  async function handleClearOpenrouterKey() {
    setSavingProviderConfig(true);
    setSettingsError("");
    try {
      const nextConfig = await updateOpenRouterApiKey("", { useDemo: false });
      const [healthData, statsData] = await Promise.all([getHealth({ useDemo: false }), getStats({ useDemo: false })]);
      setProviderConfig(nextConfig);
      setHealth(healthData);
      setStats(statsData);
      setOpenrouterDraft("");
      setSystemWarning("");
    } catch (err) {
      setSettingsError(err?.payload?.error?.message || err.message || "Failed to clear OpenRouter key");
    } finally {
      setSavingProviderConfig(false);
    }
  }

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
        modeLabel={useByokMode ? "BYOK" : useDemoData ? "Demo" : "Proxy"}
        chatMode={chatMode}
        onChatModeChange={setChatMode}
        sessionId={cloudSessionId}
      />
    );
  } else if (activeTab === "Dashboard") {
    page = (
      <Dashboard
        stats={stats}
        showProviderConfig={false}
        providerConfig={effectiveProviderConfig}
        openrouterDraft={openrouterDraft}
        onOpenrouterDraftChange={setOpenrouterDraft}
        onSaveOpenrouterKey={handleSaveOpenrouterKey}
        onClearOpenrouterKey={handleClearOpenrouterKey}
        savingProviderConfig={savingProviderConfig}
      />
    );
  } else if (activeTab === "Scoring") {
    page = <Scoring stats={stats} />;
  } else if (activeTab === "Settings") {
    page = (
      <Settings
        health={health}
        providerConfig={effectiveProviderConfig}
        openrouterDraft={openrouterDraft}
        onOpenrouterDraftChange={setOpenrouterDraft}
        onSaveOpenrouterKey={handleSaveOpenrouterKey}
        onClearOpenrouterKey={handleClearOpenrouterKey}
        savingProviderConfig={savingProviderConfig}
      />
    );
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
          <span className={`status-pill ${currentStatusClass}`}>{currentStatusLabel}</span>
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

      {DEMO_MODE ? (
        <PublicAccessPanel
          publicMode={publicMode}
          onPublicModeChange={setPublicMode}
          byokConfig={byokConfig}
          onByokConfigChange={(next) => setByokConfig((current) => ({ ...current, ...next }))}
        />
      ) : null}

      {currentPageError ? <div className="error-banner">{currentPageError}</div> : null}
      {!currentPageError && useDemoData ? (
        <div className="warning-banner">
          Public demo mode. This site uses bundled sample data and does not expose private logs or live backend traffic.
        </div>
      ) : null}
      {!currentPageError && systemWarning && activeTab !== "Chat" && activeTab !== "Settings" ? (
        <div className="warning-banner">{systemWarning}</div>
      ) : null}

      {page}
    </div>
  );
}
