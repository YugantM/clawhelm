import { buildDemoChatResponse, demoLogs, demoStats, DEMO_MODE } from "./demoData";

const API_BASE_URL = import.meta.env.DEV ? "" : (import.meta.env.VITE_API_BASE_URL || "");
const OPENAI_BASE_URL = "https://api.openai.com";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

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
    };
  }
  if (path === "/v1/chat/completions") {
    const parsed = options?.body ? JSON.parse(options.body) : { messages: [] };
    return buildDemoChatResponse(parsed.messages || []);
  }
  return null;
}

async function fetchJson(path, options, { useDemo = DEMO_MODE } = {}) {
  if (useDemo) {
    return getDemoPayload(path, options);
  }

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

export function getLogs(options) {
  return fetchJson("/logs", undefined, options);
}

export function getStats(options) {
  return fetchJson("/stats", undefined, options);
}

export function getHealth(options) {
  return fetchJson("/health", undefined, options);
}

export function postChat(messages, options) {
  return fetchJson(
    "/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "clawhelm-auto",
        messages,
      }),
    },
    options,
  );
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
