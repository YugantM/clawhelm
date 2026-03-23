import { useEffect, useRef, useState } from "react";
import Message from "./Message";
import ModelSelector from "./ModelSelector";
import { getChatModels } from "../api";

const CHAT_MODEL_STORAGE_KEY = "clawhelm_selected_chat_model";

export default function Chat({
  messages,
  pending,
  onSend,
  requireLoginForManualModels,
  onRequireLogin,
  onModelSelectionChange,
  selectedInsightId,
  onSelectInsight,
  modeLabel,
  chatMode,
  onChatModeChange,
  sessionId,
  modeLocked,
}) {
  const [input, setInput] = useState("");
  const [modelOptions, setModelOptions] = useState([
    { id: "auto", label: "Auto (recommended)", endpoint: "/chat" },
    { id: "deepseek", label: "DeepSeek (free)", endpoint: "/chat" },
    { id: "mistral", label: "Mistral (free)", endpoint: "/chat" },
    { id: "openchat", label: "OpenChat (free)", endpoint: "/chat" },
  ]);
  const [selectedModel, setSelectedModel] = useState(() => {
    if (typeof window === "undefined") return "auto";
    return window.localStorage.getItem(CHAT_MODEL_STORAGE_KEY) || "auto";
  });
  const threadRef = useRef(null);
  const submitLockRef = useRef(false);

  function handleModelChange(nextModel) {
    if (requireLoginForManualModels && nextModel !== "auto") {
      setSelectedModel("auto");
      onRequireLogin?.();
      return;
    }
    if (onModelSelectionChange && onModelSelectionChange(nextModel) === false) {
      return;
    }
    setSelectedModel(nextModel);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHAT_MODEL_STORAGE_KEY, selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    let active = true;

    async function loadModelOptions() {
      try {
        const payload = await getChatModels({ useDemo: false });
        if (!active || !Array.isArray(payload) || payload.length === 0) return;
        const normalized = payload
          .filter((option) => typeof option?.id === "string" && typeof option?.label === "string")
          .map((option) => ({
            id: option.id,
            label:
              option.id === "auto"
                ? `${option.label} (recommended)`
                : option.is_free
                  ? `${option.label} (free)`
                  : option.label,
            endpoint: typeof option.endpoint === "string" && option.endpoint.trim() ? option.endpoint.trim() : "/chat",
          }));

        if (normalized.length > 0) {
          setModelOptions(normalized);
        }
      } catch {
        // Keep static defaults if endpoint config is unavailable.
      }
    }

    loadModelOptions().catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, pending]);

  async function submitPrompt() {
    const value = input.trim();
    if (!value || pending || submitLockRef.current) return;
    submitLockRef.current = true;
    setInput("");
    try {
      await onSend(value, selectedModel);
    } finally {
      submitLockRef.current = false;
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    await submitPrompt();
  }

  async function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      await submitPrompt();
    }
  }

  return (
    <section className="chat-shell">
      <div className="chat-thread" ref={threadRef}>
        {messages.length === 0 ? (
          <div className="chat-empty">
            <h3>Ask anything.</h3>
            <p>We find the best answer across AI models — automatically.</p>
          </div>
        ) : (
          messages.map((message) => (
            <Message
              key={message.id}
              role={message.role}
              content={message.content}
              insight={message.insight}
              active={selectedInsightId === message.insight?.id}
              onSelect={() => {
                if (message.insight) onSelectInsight(message.insight.id);
              }}
            />
          ))
        )}
        {pending ? (
          <div className="message-row message-row--assistant">
            <div className="message-bubble message-bubble--assistant message-bubble--loading" aria-live="polite">
              <span className="message-bubble__meta">ClawHelm</span>
              <p>Thinking...</p>
            </div>
          </div>
        ) : null}
      </div>

      <form className="chat-composer" onSubmit={handleSubmit}>
        <div className="chat-composer__model-row">
          <ModelSelector value={selectedModel} onChange={handleModelChange} options={modelOptions} />
        </div>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask clawhelm something..."
          rows={3}
        />
        <div className="chat-composer__footer">
          <span className="chat-composer__hint">⚡ Optimized for speed, cost, and quality</span>
          <button type="submit" disabled={pending}>
            {pending ? "Sending..." : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}
