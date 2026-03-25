const API_BASE_URL = import.meta.env.DEV ? "" : (import.meta.env.VITE_API_BASE_URL || "");

// Auth token management
const TOKEN_KEY = "clawhelm_auth_token";

export function setAuthToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function resolveModelAlias(modelAlias = "auto") {
  if (modelAlias === "auto") return "clawhelm-auto";
  return modelAlias;
}

async function fetchJson(path, options = {}) {
  const token = getAuthToken();
  const headers = { ...(options.headers || {}) };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
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

export function getLogs() {
  return fetchJson("/logs");
}

export function getStats() {
  return fetchJson("/stats");
}

export function getHealth() {
  return fetchJson("/health");
}

export function getProviderConfig() {
  return fetchJson("/config/providers");
}

export function updateOpenRouterApiKey(apiKey) {
  return fetchJson("/config/providers/openrouter", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-ClawHelm-Client": "dashboard",
    },
    body: JSON.stringify({ api_key: apiKey }),
  });
}

export function postChat(messages, requestOptions) {
  const modelAlias = requestOptions?.model || "auto";
  return fetchJson("/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-ClawHelm-Client": "dashboard",
    },
    body: JSON.stringify({
      model: resolveModelAlias(modelAlias),
      messages,
    }),
  });
}

export function getChatModels() {
  return fetchJson("/chat/models");
}

// Auth endpoints
export function getAuthProviders() {
  return fetchJson("/auth/providers");
}

export function getCurrentUser() {
  return fetchJson("/auth/me").catch(() => null);
}

export function logout() {
  setAuthToken(null);
  return fetchJson("/auth/logout", { method: "POST" });
}

// Session endpoints
export function getSessions() {
  return fetchJson("/sessions");
}

export function createSession(title) {
  return fetchJson("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

export function getSession(sessionId) {
  return fetchJson(`/sessions/${sessionId}`);
}

export function deleteSession(sessionId) {
  return fetchJson(`/sessions/${sessionId}`, { method: "DELETE" });
}

export function addSessionMessage(sessionId, role, content, meta = null) {
  return fetchJson(`/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, content, meta }),
  });
}
