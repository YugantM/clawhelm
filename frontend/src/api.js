import { buildDemoChatResponse, demoLogs, demoStats, DEMO_MODE } from "./demoData";

const API_BASE_URL = import.meta.env.DEV ? "" : (import.meta.env.VITE_API_BASE_URL || "");

async function fetchJson(path, options) {
  if (DEMO_MODE) {
    if (path === "/logs") return demoLogs;
    if (path === "/stats") return demoStats;
    if (path === "/v1/chat/completions") {
      const parsed = options?.body ? JSON.parse(options.body) : { messages: [] };
      return buildDemoChatResponse(parsed.messages || []);
    }
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

export function getLogs() {
  return fetchJson("/logs");
}

export function getStats() {
  return fetchJson("/stats");
}

export function postChat(messages) {
  return fetchJson("/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "clawhelm-auto",
      messages,
    }),
  });
}
