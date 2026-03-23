import { buildDemoChatResponse, demoLogs, demoStats, DEMO_MODE } from "./demoData";

const API_BASE_URL = import.meta.env.DEV ? "" : (import.meta.env.VITE_API_BASE_URL || "");
const OPENAI_BASE_URL = "https://api.openai.com";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const MODEL_ALIAS_TO_ID = {
  auto: "clawhelm-auto",
  deepseek: "deepseek/deepseek-chat:free",
  mistral: "mistralai/mistral-7b-instruct:free",
  openchat: "openchat/openchat-7b:free",
};

export function resolveModelAlias(modelAlias = "auto") {
  if (modelAlias === "auto") {
    return MODEL_ALIAS_TO_ID.auto;
  }
  return MODEL_ALIAS_TO_ID[modelAlias] || modelAlias;
}

function getDemoPayload(path, options) {
  if (path === "/logs") return demoLogs;
  if (path === "/stats") return demoStats;
  if (path === "/health") {
    return {
      status: "ok",
      service: "clawhelm-demo",
      provider_base_url: OPENAI_BASE_URL,
      openrouter_enabled: true,
      allow_openai_routing: true,
      allow_openrouter_routing: true,
      db_path: "demo://bundled-sample-data",
      settings_path: "demo://bundled-sample-data",
      openrouter_key_configured: true,
    };
  }
  if (path === "/config/providers") {
    return {
      settings_path: "demo://bundled-sample-data",
      providers: {
        openrouter: {
          configured: true,
          source: "demo",
          masked_key: "demo********key",
        },
        openai: {
          configured: false,
          source: "missing",
          masked_key: null,
        },
      },
    };
  }
  if (path === "/v1/chat/completions") {
    const parsed = options?.body ? JSON.parse(options.body) : { messages: [] };
    return buildDemoChatResponse(parsed.messages || []);
  }
  if (path === "/chat/models") {
    return [
      { id: "auto", label: "Auto", model_id: null, endpoint: "/chat", is_free: false, recommended: true },
      { id: "deepseek", label: "DeepSeek", model_id: "deepseek/deepseek-chat:free", endpoint: "/chat", is_free: true, recommended: false },
      { id: "mistral", label: "Mistral", model_id: "mistralai/mistral-7b-instruct:free", endpoint: "/chat", is_free: true, recommended: false },
      { id: "openchat", label: "OpenChat", model_id: "openchat/openchat-7b:free", endpoint: "/chat", is_free: true, recommended: false },
    ];
  }
  return null;
}

async function fetchJson(path, options, { useDemo = DEMO_MODE } = {}) {
  if (useDemo) {
    return getDemoPayload(path, options);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    ...options,
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw_text: text };
  }

  if (!response.ok) {
    const error = new Error(`Request failed: ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function resolveRequestTarget(pathOrUrl) {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  return `${API_BASE_URL}${pathOrUrl}`;
}

export function getLogs(options) {
  return fetchJson("/logs", undefined, options);
}

export function getStats(options) {
  return fetchJson("/stats", undefined, options);
}

export function getHealth(options) {
  return fetchJson("/health", undefined, options);
}

export function getProviderConfig(options) {
  return fetchJson("/config/providers", undefined, options);
}

export function getUserAccount(userId, options) {
  return fetchJson(`/user/${encodeURIComponent(userId)}`, undefined, options);
}

export function getAuthMe(options) {
  return fetchJson("/auth/me", undefined, options);
}

export function signup(payload, options) {
  return fetchJson(
    "/auth/signup",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ClawHelm-Client": "dashboard",
      },
      body: JSON.stringify(payload),
    },
    options,
  );
}

export function login(payload, options) {
  return fetchJson(
    "/auth/login",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ClawHelm-Client": "dashboard",
      },
      body: JSON.stringify(payload),
    },
    options,
  );
}

export function logout(options) {
  return fetchJson(
    "/auth/logout",
    {
      method: "POST",
      headers: {
        "X-ClawHelm-Client": "dashboard",
      },
    },
    options,
  );
}

export function getOAuthStartUrl(provider) {
  return `${API_BASE_URL}/auth/oauth/${provider}/start`;
}

export function createCheckoutSession(userId, options) {
  return fetchJson(
    "/create-checkout-session",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ClawHelm-Client": "dashboard",
      },
      body: JSON.stringify({
        user_id: userId,
      }),
    },
    options,
  );
}

export function updateOpenRouterApiKey(apiKey, options) {
  return fetchJson(
    "/config/providers/openrouter",
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-ClawHelm-Client": "dashboard",
      },
      body: JSON.stringify({
        api_key: apiKey,
      }),
    },
    options,
  );
}

export function postChat(messages, requestOptions, options) {
  const modelAlias = requestOptions?.model || "auto";
  return fetchJson(
    "/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ClawHelm-Client": "dashboard",
      },
      body: JSON.stringify({
        model: resolveModelAlias(modelAlias),
        messages,
      }),
    },
    options,
  );
}

export function postCloudChat({ message, sessionId, model = "auto" }, options) {
  return fetchJson(
    "/chat",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ClawHelm-Client": "dashboard",
        "X-Session-Id": sessionId,
      },
      body: JSON.stringify({
        message,
        model: model === "clawhelm-auto" ? "auto" : model,
        session_id: sessionId,
      }),
    },
    options,
  );
}

export function getChatModels(options) {
  return fetchJson("/chat/models", undefined, options);
}

export async function postChatByok({
  provider,
  apiKey,
  model,
  messages,
  referer = typeof window !== "undefined" ? window.location.origin : "",
}) {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    const error = new Error("Missing API key");
    error.status = 400;
    error.payload = { error: { message: "Enter an API key to use BYOK mode." } };
    throw error;
  }

  const baseUrl = provider === "openrouter" ? OPENROUTER_BASE_URL : OPENAI_BASE_URL;
  const chatPath = provider === "openrouter" ? "/chat/completions" : "/v1/chat/completions";
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${trimmedKey}`,
  };

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = referer;
    headers["X-Title"] = "ClawHelm BYOK";
  }

  const response = await fetch(`${baseUrl}${chatPath}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
    }),
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw_text: text };
  }

  if (!response.ok) {
    const error = new Error(`Request failed: ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}
