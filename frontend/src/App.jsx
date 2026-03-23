import { useEffect, useMemo, useRef, useState } from "react";
import {
  createCheckoutSession,
  getHealth,
  getLogs,
  getProviderConfig,
  getStats,
  getAuthMe,
  getOAuthStartUrl,
  postChat,
  postChatByok,
  postCloudChat,
  resolveModelAlias,
  login,
  logout,
  signup,
  updateOpenRouterApiKey,
} from "./api";
import { DEMO_MODE } from "./demoData";
import ChatPage from "./pages/ChatPage";
import Dashboard from "./pages/Dashboard";
import LoginPage from "./pages/LoginPage";
import Logs from "./pages/Logs";
import Settings from "./pages/Settings";

const REFRESH_INTERVAL_MS = 4000;
let globalPendingSend = false;
const TABS = ["Chat", "Dashboard", "Logs", "Settings"];
const MENU_ITEMS = [
  { id: "chat", label: "Chat", tab: "Chat" },
  { id: "dashboard", label: "Dashboard", tab: "Dashboard" },
  { id: "logs", label: "Logs", tab: "Logs" },
  { id: "settings", label: "Settings", tab: "Settings" },
];
const STORAGE_KEYS = {
  publicMode: "clawhelm_public_mode",
  byokProvider: "clawhelm_byok_provider",
  byokApiKey: "clawhelm_byok_api_key",
  byokModel: "clawhelm_byok_model",
  chatMode: "clawhelm_chat_mode",
  cloudSessionId: "clawhelm_cloud_session_id",
};

function getNavigationFromHash() {
  const hashValue = window.location.hash.replace(/^#/, "").trim();
  if (hashValue === "Scoring") return { tab: "Dashboard" };
  if (TABS.includes(hashValue)) {
    return { tab: hashValue };
  }
  return { tab: "Chat" };
}

function getInitialPublicMode() {
  return "live";
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

function createMessageId(prefix) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
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

function getCheckoutNotice() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  const checkout = params.get("checkout");
  if (checkout === "success") return "Stripe checkout completed. Refreshing your plan now.";
  if (checkout === "cancel") return "Stripe checkout was canceled.";
  if (params.get("auth") === "error") return "Authentication failed. Try again.";
  return "";
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

function inferProviderFromModel(modelId) {
  if (!modelId || modelId === "clawhelm-auto") return null;
  if (modelId.startsWith("openrouter/") || modelId.endsWith(":free")) {
    return "openrouter";
  }
  return "openai";
}

function buildFallbackInsight(response, selectedModel) {
  const resolvedSelectedModel = resolveModelAlias(selectedModel || "auto");
  const selectedValue = response?.selected_model || resolvedSelectedModel || "clawhelm-auto";
  const actualValue = response?.actual_model || response?.model || selectedValue;
  const provider = inferProviderFromModel(actualValue) || inferProviderFromModel(selectedValue) || "unknown";
  const fallbackUsed = Boolean(response?.fallback_used);
  const fallbackFromModel = response?.fallback_from_model || null;
  const fallbackToModel = response?.fallback_to_model || (fallbackUsed ? actualValue : null);

  return {
    id: createMessageId("insight"),
    timestamp: new Date().toISOString(),
    selected_model: selectedValue,
    actual_model: actualValue,
    model_display_name: actualValue !== selectedValue ? `${selectedValue} -> ${actualValue}` : actualValue,
    provider,
    routing_reason: "pending log sync",
    latency: typeof response?.latency === "number" ? response.latency : null,
    total_tokens: response?.usage?.total_tokens ?? null,
    fallback_used: fallbackUsed,
    fallback_from_model: fallbackFromModel,
    fallback_to_model: fallbackToModel,
    response: normalizeAssistantContent(response, null),
  };
}

function PublicAccessPanel({ id, publicMode, onPublicModeChange, byokConfig, onByokConfigChange }) {
  return (
    <section className="access-panel panel" id={id}>
      <div className="access-panel__header">
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
              placeholder="Paste your OpenRouter or provider key"
            />
          </label>
        </div>
      ) : null}
    </section>
  );
}

export default function App() {
  const iconSrc = `${import.meta.env.BASE_URL}clawhelm-icon.svg`;
  const [activeTab, setActiveTab] = useState(() => getNavigationFromHash().tab);
  const [publicMode, setPublicMode] = useState(getInitialPublicMode);
  const [byokConfig, setByokConfig] = useState(getInitialByokConfig);
  const [chatMode, setChatMode] = useState(getInitialChatMode);
  const [cloudSessionId, setCloudSessionId] = useState(getInitialCloudSessionId);
  const [currentUser, setCurrentUser] = useState(null);
  const [account, setAccount] = useState(null);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [health, setHealth] = useState(null);
  const [providerConfig, setProviderConfig] = useState(null);
  const [openrouterDraft, setOpenrouterDraft] = useState("");
  const [localMessages, setLocalMessages] = useState([]);
  const [cloudMessages, setCloudMessages] = useState([]);
  const [selectedInsightIds, setSelectedInsightIds] = useState({ local: null, cloud: null });
  const [loading, setLoading] = useState(true);
  const [pendingChat, setPendingChat] = useState(false);
  const [chatError, setChatError] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [systemWarning, setSystemWarning] = useState("");
  const [savingProviderConfig, setSavingProviderConfig] = useState(false);
  const [authPending, setAuthPending] = useState(false);
  const [authError, setAuthError] = useState("");
  const [billingPending, setBillingPending] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(420);
  const pendingChatRef = useRef(false);
  const messagesRef = useRef([]);
  const isResizingPanelRef = useRef(false);

  const isAuthenticated = Boolean(currentUser);
  const showFullUi = isAuthenticated;
  const useDemoData = false;
  const useByokMode = false;
  const accountBillingMode = isAuthenticated && !useDemoData && !useByokMode;
  const runtimeChatMode = accountBillingMode ? "cloud" : chatMode;
  const activeModeKey = useDemoData || useByokMode ? "local" : runtimeChatMode;
  const messages = activeModeKey === "cloud" ? cloudMessages : localMessages;
  const setMessages = activeModeKey === "cloud" ? setCloudMessages : setLocalMessages;
  const selectedInsightId = selectedInsightIds[activeModeKey];
  const setSelectedInsightId = (value) =>
    setSelectedInsightIds((current) => ({ ...current, [activeModeKey]: value }));

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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
    function handleWindowClick() {
      setAccountMenuOpen(false);
    }

    window.addEventListener("click", handleWindowClick);
    return () => {
      window.removeEventListener("click", handleWindowClick);
    };
  }, []);

  useEffect(() => {
    function handlePointerMove(event) {
      if (!isResizingPanelRef.current) return;
      const minWidth = 320;
      const maxWidth = Math.min(760, window.innerWidth - 420);
      const computed = Math.max(minWidth, Math.min(maxWidth, window.innerWidth - event.clientX - 18));
      setPanelWidth(computed);
    }

    function stopResize() {
      isResizingPanelRef.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", stopResize);
    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", stopResize);
    };
  }, []);

  useEffect(() => {
    if (useDemoData) {
      setLocalMessages([]);
      setCloudMessages([]);
      setSelectedInsightIds({ local: null, cloud: null });
    }
  }, [useDemoData]);

  useEffect(() => {
    setPendingChat(false);
    setChatError("");
  }, [chatMode]);

  useEffect(() => {
    function syncTabFromHash() {
      const next = getNavigationFromHash();
      setActiveTab(next.tab);
    }

    syncTabFromHash();
    window.addEventListener("hashchange", syncTabFromHash);
    return () => {
      window.removeEventListener("hashchange", syncTabFromHash);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const notice = getCheckoutNotice();
    if (!notice) return;
    setSystemWarning(notice);
    const nextUrl = `${window.location.pathname}${window.location.hash || ""}`;
    window.history.replaceState({}, document.title, nextUrl);
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
  }, [byokConfig.provider, currentUser, logs, useByokMode, useDemoData]);

  useEffect(() => {
    let active = true;

    async function loadAccount() {
      if (useDemoData || useByokMode) {
        if (active) setAccount(null);
        return;
      }

      try {
        const accountData = await getAuthMe({ useDemo: false });
        if (!active) return;
        setCurrentUser(accountData);
        setAccount(accountData);
        setAuthError("");
      } catch (err) {
        if (!active) return;
        if (err?.status === 401) {
          setCurrentUser(null);
          setAccount(null);
          setAuthError("");
          return;
        }
        setAuthError(err?.payload?.detail || err.message || "Failed to load account");
      }
    }

    loadAccount().catch(() => {});
    return () => {
      active = false;
    };
  }, [billingPending, useByokMode, useDemoData]);

  async function handleSend(prompt, selectedModel = "auto") {
    if (pendingChatRef.current || globalPendingSend) {
      return;
    }

    if (isAuthenticated && selectedModel !== "auto") {
      const resolvedModel = resolveModelAlias(selectedModel);
      const requiredProvider = inferProviderFromModel(resolvedModel);
      const isProviderConfigured = requiredProvider ? Boolean(effectiveProviderConfig?.providers?.[requiredProvider]?.configured) : true;

      if (!isProviderConfigured) {
        setSettingsError(
          `Configure ${requiredProvider === "openrouter" ? "OpenRouter" : "OpenAI"} API key in Settings before using ${selectedModel}.`,
        );
        setActiveTab("Settings");
        window.location.hash = "Settings";
        return;
      }
    }

    pendingChatRef.current = true;
    globalPendingSend = true;
    const previousTopLogId = logs[0]?.id ?? null;
    const userMessage = createMessage(createMessageId("user"), "user", prompt);
    const assistantMessageId = createMessageId("assistant");
    const nextMessages = [...messagesRef.current, userMessage];
    setMessages(nextMessages);
    setPendingChat(true);
    setChatError("");

    try {
      if (useByokMode) {
        const startedAt = performance.now();
        const response = await postChatByok({
          provider: byokConfig.provider,
          apiKey: byokConfig.apiKey,
          model: selectedModel === "auto" ? byokConfig.model : resolveModelAlias(selectedModel),
          messages: nextMessages.map((message) => ({ role: message.role, content: message.content })),
        });
        const insight = buildByokInsight({
          response,
          provider: byokConfig.provider,
          model: selectedModel === "auto" ? byokConfig.model : resolveModelAlias(selectedModel),
          prompt: nextMessages.map((message) => ({ role: message.role, content: message.content })),
          startedAt,
        });
        const assistantContent = normalizeAssistantContent(response, insight);
        setMessages((current) => [...current, createMessage(assistantMessageId, "assistant", assistantContent, insight)]);
        setPendingChat(false);
        setLogs((current) => [insight, ...current].slice(0, 50));
        setSelectedInsightId(insight.id);
        return;
      }

      if (!useDemoData && runtimeChatMode === "cloud") {
        const sessionId = cloudSessionId || createSessionId();
        if (sessionId !== cloudSessionId) {
          setCloudSessionId(sessionId);
        }

        const response = await postCloudChat({ message: prompt, sessionId, model: selectedModel }, { useDemo: false });
        if (response?.user_id) {
          setAccount((current) => ({
            user_id: response.user_id,
            email: currentUser?.email || current?.email,
            name: currentUser?.name || current?.name,
            plan: response.plan || current?.plan || "free",
            requests_today: response?.usage?.requests_today ?? current?.requests_today ?? 0,
            limit: response?.usage?.limit ?? current?.limit ?? 20,
            remaining: response?.usage?.remaining ?? current?.remaining ?? 0,
            last_updated: current?.last_updated || new Date().toISOString().slice(0, 10),
          }));
        }
        const optimisticAssistantContent = normalizeAssistantContent(response, null);
        const fallbackInsight = buildFallbackInsight(response, selectedModel);
        setMessages((current) => [...current, createMessage(assistantMessageId, "assistant", optimisticAssistantContent, fallbackInsight)]);
        setPendingChat(false);
        setSelectedInsightId(fallbackInsight.id);

        try {
          const { logsData } = await waitForSessionLog(sessionId, previousTopLogId);
          setLogs(logsData);
          try {
            const [statsData, healthData] = await Promise.all([getStats({ useDemo: false }), getHealth({ useDemo: false })]);
            setStats(statsData);
            setHealth(healthData);
            setSystemWarning("");
          } catch (statsError) {
            setSystemWarning(statsError.message || "Metrics refresh delayed");
          }
        } catch (refreshError) {
          setSystemWarning(refreshError.message || "Cloud log refresh delayed");
        }

        return;
      }

      const response = await postChat(
        nextMessages.map((message) => ({ role: message.role, content: message.content })),
        { model: selectedModel },
        { useDemo: useDemoData },
      );
      const optimisticAssistantContent = normalizeAssistantContent(response, null);
      const fallbackInsight = buildFallbackInsight(response, selectedModel);
      setMessages((current) => [...current, createMessage(assistantMessageId, "assistant", optimisticAssistantContent, fallbackInsight)]);
      setPendingChat(false);
      setSelectedInsightId(fallbackInsight.id);

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
      } catch (refreshError) {
        setSystemWarning(refreshError.message || "Log refresh delayed");
      }
    } catch (err) {
      const errorPayload = err?.payload || null;
      const assistantErrorContent = normalizeAssistantContent(errorPayload, logs[0] || null);
      if (errorPayload?.user_id) {
        setAccount((current) => ({
          user_id: errorPayload.user_id,
          plan: errorPayload.plan || current?.plan || "free",
          requests_today: current?.requests_today ?? 0,
          limit: errorPayload.limit ?? current?.limit ?? 20,
          remaining: current?.remaining ?? 0,
          last_updated: current?.last_updated || new Date().toISOString().slice(0, 10),
        }));
      }

      if (useByokMode) {
        const startedAt = performance.now();
        const insight = buildByokInsight({
          response: errorPayload || { raw_text: assistantErrorContent },
          provider: byokConfig.provider,
          model: selectedModel === "auto" ? byokConfig.model : resolveModelAlias(selectedModel),
          prompt: nextMessages.map((message) => ({ role: message.role, content: message.content })),
          startedAt,
          statusCode: err?.status || 500,
        });
        setMessages((current) => [...current, createMessage(assistantMessageId, "assistant", assistantErrorContent, insight)]);
        setPendingChat(false);
        setLogs((current) => [insight, ...current].slice(0, 50));
        setSelectedInsightId(insight.id);
      } else if (runtimeChatMode === "cloud") {
        const fallbackInsight = buildFallbackInsight(errorPayload || {}, selectedModel);
        setMessages((current) => [...current, createMessage(assistantMessageId, "assistant", assistantErrorContent, fallbackInsight)]);
        setPendingChat(false);
        setSelectedInsightId(fallbackInsight.id);
        try {
          const { logsData } = await waitForSessionLog(cloudSessionId, previousTopLogId);
          setLogs(logsData);
        } catch {
          // Keep assistant error bubble visible even if logs lag behind.
        }
      } else {
        const fallbackInsight = buildFallbackInsight(errorPayload || {}, selectedModel);
        setMessages((current) => [...current, createMessage(assistantMessageId, "assistant", assistantErrorContent, fallbackInsight)]);
        setPendingChat(false);
        setSelectedInsightId(fallbackInsight.id);

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
        } catch {
          // Keep the assistant error bubble even if logs lag behind.
        }
      }

      if (errorPayload) {
        setChatError("");
      } else {
        setChatError(err.message || "Failed to send chat request");
      }
    } finally {
      pendingChatRef.current = false;
      globalPendingSend = false;
      setPendingChat(false);
    }
  }

  const selectedInsight = useMemo(
    () => logs.find((entry) => entry.id === selectedInsightId) || messages.find((message) => message.insight?.id === selectedInsightId)?.insight || null,
    [logs, messages, selectedInsightId],
  );
  const effectiveProviderConfig = useMemo(() => buildEffectiveProviderConfig(providerConfig, health), [providerConfig, health]);
  const currentPageError = !showFullUi || activeTab === "Chat" ? chatError : activeTab === "Settings" ? settingsError : "";
  const currentStatusClass = currentPageError
    ? "status-pill--danger"
    : useByokMode
      ? "status-pill--byok"
      : useDemoData
        ? "status-pill--demo"
        : "status-pill--live";
  const currentStatusLabel = currentPageError
    ? !showFullUi || activeTab === "Chat"
      ? "Chat error"
      : "Settings error"
    : useByokMode
      ? "BYOK"
      : useDemoData
        ? "Demo"
        : "Live";
  const userDisplayName = "Account";
  const userInitial = userDisplayName.trim().charAt(0).toUpperCase() || "A";

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

  async function handleSignup(nextUser) {
    setAuthPending(true);
    setAuthError("");
    try {
      const user = await signup(nextUser, { useDemo: false });
      setCurrentUser(user);
      setAccount(user);
      setActiveTab("Chat");
      window.location.hash = "Chat";
    } catch (err) {
      setAuthError(err?.payload?.detail || err.message || "Failed to create account");
    } finally {
      setAuthPending(false);
    }
  }

  async function handleLogin(nextUser) {
    setAuthPending(true);
    setAuthError("");
    try {
      const user = await login(nextUser, { useDemo: false });
      setCurrentUser(user);
      setAccount(user);
      setActiveTab("Chat");
      window.location.hash = "Chat";
    } catch (err) {
      setAuthError(err?.payload?.detail || err.message || "Failed to log in");
    } finally {
      setAuthPending(false);
    }
  }

  function handleOAuth(provider) {
    window.location.assign(getOAuthStartUrl(provider));
  }

  function handleOpenLogin() {
    if (typeof document === "undefined") return;
    document.getElementById("login-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleRequireLoginForModelSelection() {
    setAuthError("Log in to use a specific model. Auto mode is available without login.");
    handleOpenLogin();
  }

  function handleModelSelectionChange(nextModel) {
    if (!isAuthenticated || nextModel === "auto") {
      return true;
    }

    const resolvedModel = resolveModelAlias(nextModel);
    const requiredProvider = inferProviderFromModel(resolvedModel);
    const isProviderConfigured = requiredProvider ? Boolean(effectiveProviderConfig?.providers?.[requiredProvider]?.configured) : true;

    if (!isProviderConfigured) {
      setSettingsError(
        `Configure ${requiredProvider === "openrouter" ? "OpenRouter" : "OpenAI"} API key in Settings before using ${nextModel}.`,
      );
      setActiveTab("Settings");
      window.location.hash = "Settings";
      return false;
    }

    return true;
  }

  async function handleLogout() {
    try {
      await logout({ useDemo: false });
    } catch {
      // clear local state even if backend logout races
    }
    setCurrentUser(null);
    setAccount(null);
    setLocalMessages([]);
    setCloudMessages([]);
    setSelectedInsightIds({ local: null, cloud: null });
    setChatError("");
    setSystemWarning("");
  }

  async function handleCheckout() {
    if (!currentUser) {
      setAuthError("Sign in before starting checkout.");
      return;
    }

    setBillingPending(true);
    setSettingsError("");
    try {
      const payload = await createCheckoutSession(undefined, { useDemo: false });
      window.location.assign(payload.url);
    } catch (err) {
      setSettingsError(err?.payload?.detail?.error?.message || err?.payload?.detail || err.message || "Failed to create checkout session");
    } finally {
      setBillingPending(false);
    }
  }

  const chatView = (
    <ChatPage
      messages={messages}
      pending={pendingChat}
      onSend={handleSend}
      requireLoginForManualModels={!isAuthenticated}
      onRequireLogin={handleRequireLoginForModelSelection}
      onModelSelectionChange={handleModelSelectionChange}
      selectedInsightId={selectedInsightId}
      onSelectInsight={(value) => setSelectedInsightIds((current) => ({ ...current, [activeModeKey]: value }))}
      selectedInsight={selectedInsight}
      modeLabel={useByokMode ? "BYOK" : useDemoData ? "Demo" : "Proxy"}
      chatMode={runtimeChatMode}
      onChatModeChange={setChatMode}
      sessionId={cloudSessionId}
      modeLocked={accountBillingMode}
    />
  );

  let utilityPanel = null;
  const navigateTo = (tab) => {
    setActiveTab(tab);
    window.location.hash = tab;
  };

  if (showFullUi && activeTab !== "Chat") {
    if (activeTab === "Dashboard") {
      utilityPanel = (
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
    } else if (activeTab === "Logs") {
      utilityPanel = <Logs logs={logs} loading={loading} compact />;
    } else if (activeTab === "Settings") {
      utilityPanel = (
        <Settings
          user={currentUser}
          account={account}
          health={health}
          providerConfig={effectiveProviderConfig}
          openrouterDraft={openrouterDraft}
          onOpenrouterDraftChange={setOpenrouterDraft}
          onSaveOpenrouterKey={handleSaveOpenrouterKey}
          onClearOpenrouterKey={handleClearOpenrouterKey}
          savingProviderConfig={savingProviderConfig}
          onCheckout={handleCheckout}
          billingPending={billingPending}
        />
      );
    }
  }

  return (
    <div className="app-shell">
      <header className="chat-app-header">
        <div className="chat-app-header__brand">
          <img className="brand-lockup__icon" src={iconSrc} alt="" aria-hidden="true" />
          <div className="chat-app-header__brand-copy">
            <strong>ClawHelm</strong>
            <span>Search across AI models</span>
          </div>
        </div>
        <div className="chat-app-header__actions">
          {!showFullUi ? (
            <button
              type="button"
              className="ghost-button chat-app-header__login"
              onClick={handleOpenLogin}
            >
              Log in
            </button>
          ) : null}
          {showFullUi && currentUser ? (
            <div className={`account-menu ${accountMenuOpen ? "account-menu--open" : ""}`}>
              <button
                type="button"
                className="account-menu__trigger"
                onClick={(event) => {
                  event.stopPropagation();
                  setAccountMenuOpen((value) => !value);
                }}
                aria-expanded={accountMenuOpen}
              >
                <span className="account-menu__avatar" aria-hidden="true">
                  {userInitial}
                </span>
                <span className="account-menu__name">{userDisplayName}</span>
              </button>
              {accountMenuOpen ? (
                <div
                  className="account-menu__panel"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="account-menu__identity">
                    <span>Signed in</span>
                    <strong>{currentUser.plan || "free"} plan</strong>
                  </div>
                  <div className="account-menu__nav" role="menu" aria-label="Navigation">
                    {MENU_ITEMS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`ghost-button account-menu__item ${activeTab === item.tab ? "account-menu__item--active" : ""}`}
                        onClick={() => {
                          navigateTo(item.tab);
                          setAccountMenuOpen(false);
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="ghost-button account-menu__item account-menu__logout"
                    onClick={async () => {
                      setAccountMenuOpen(false);
                      await handleLogout();
                    }}
                  >
                    Log out
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <span className={`status-pill ${currentStatusClass}`}>{currentStatusLabel}</span>
        </div>
      </header>

      {currentPageError ? <div className="error-banner">{currentPageError}</div> : null}
      {!currentPageError && systemWarning && showFullUi && activeTab !== "Chat" && activeTab !== "Settings" ? (
        <div className="warning-banner">{systemWarning}</div>
      ) : null}

      <div
        className={`workspace-shell ${utilityPanel ? "workspace-shell--with-panel" : ""}`}
        style={utilityPanel ? { "--panel-width": `${panelWidth}px` } : undefined}
      >
        <div className="workspace-shell__chat">{chatView}</div>
        {utilityPanel ? (
          <button
            type="button"
            className="workspace-shell__resizer"
            aria-label="Resize side panel"
            onMouseDown={(event) => {
              event.preventDefault();
              isResizingPanelRef.current = true;
              document.body.style.userSelect = "none";
              document.body.style.cursor = "col-resize";
            }}
          />
        ) : null}
        {utilityPanel ? (
          <aside className="workspace-shell__panel">
            <div className="workspace-panel__header">
              <h2>{activeTab}</h2>
              <button
                type="button"
                className="ghost-button workspace-panel__close"
                onClick={() => navigateTo("Chat")}
              >
                Close
              </button>
            </div>
            <div className="workspace-panel__body workspace-panel__body--compact">{utilityPanel}</div>
          </aside>
        ) : null}
      </div>

      {!showFullUi ? (
        <LoginPage
          onSignup={handleSignup}
          onLogin={handleLogin}
          onOAuth={handleOAuth}
          pending={authPending}
          error={authError}
          oauthReady={{
            google: Boolean(health?.google_oauth_configured),
            github: Boolean(health?.github_oauth_configured),
          }}
        />
      ) : null}
    </div>
  );
}
