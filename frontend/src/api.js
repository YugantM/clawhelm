const API_BASE_URL = import.meta.env.DEV ? "" : (import.meta.env.VITE_API_BASE_URL || "");

export function resolveModelAlias(modelAlias = "auto") {
  if (modelAlias === "auto") return "clawhelm-auto";
  return modelAlias;
}

async function fetchJson(path, options) {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
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
  return fetchJson("/auth/me", { credentials: "include" }).catch(() => null);
}

export function logout() {
  return fetchJson("/auth/logout", {
    method: "POST",
    credentials: "include",
  });
}

// Session endpoints
export function getSessions() {
  return fetchJson("/sessions", { credentials: "include" });
}

export function createSession(title) {
  return fetchJson("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
    credentials: "include",
  });
}

export function getSession(sessionId) {
  return fetchJson(`/sessions/${sessionId}`, { credentials: "include" });
}

export function deleteSession(sessionId) {
  return fetchJson(`/sessions/${sessionId}`, {
    method: "DELETE",
    credentials: "include",
  });
}
