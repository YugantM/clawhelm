import { useState } from "react";
import Message from "./Message";

export default function Chat({
  messages,
  pending,
  onSend,
  selectedInsightId,
  onSelectInsight,
  modeLabel,
  chatMode,
  onChatModeChange,
  sessionId,
}) {
  const [input, setInput] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    const value = input.trim();
    if (!value || pending) return;
    setInput("");
    await onSend(value);
  }

  async function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const value = input.trim();
      if (!value || pending) return;
      setInput("");
      await onSend(value);
    }
  }

  return (
    <section className="chat-shell panel">
      <div className="section-heading">
        <div>
          <h2>Conversation</h2>
          <p>
            {modeLabel === "BYOK"
              ? "Send prompts directly from this browser using your own provider key."
              : modeLabel === "Demo"
                ? "Bundled sample conversation mode for the public demo."
                : chatMode === "cloud"
                  ? "Cloud chat mode uses the /chat session endpoint with persistent session ids."
                  : "Local mode sends prompts through the OpenAI-compatible proxy endpoint."}
          </p>
        </div>
        {modeLabel === "Proxy" ? (
          <div className="chat-mode-switch" role="tablist" aria-label="Chat runtime mode">
            <button
              type="button"
              className={chatMode === "local" ? "chat-mode-switch__button chat-mode-switch__button--active" : "chat-mode-switch__button"}
              onClick={() => onChatModeChange("local")}
            >
              Local Mode
            </button>
            <button
              type="button"
              className={chatMode === "cloud" ? "chat-mode-switch__button chat-mode-switch__button--active" : "chat-mode-switch__button"}
              onClick={() => onChatModeChange("cloud")}
            >
              Cloud Mode
            </button>
          </div>
        ) : null}
      </div>

      {modeLabel === "Proxy" && chatMode === "cloud" ? (
        <div className="chat-session-meta">
          <span>Session</span>
          <strong>{sessionId}</strong>
        </div>
      ) : null}

      <div className="chat-thread">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <h3>No conversation yet</h3>
            <p>Start a message to see routing choices, provider selection, and actual model attribution.</p>
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
      </div>

      <form className="chat-composer" onSubmit={handleSubmit}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask clawhelm something..."
          rows={3}
        />
        <div className="chat-composer__footer">
          <span className="chat-composer__hint">Enter to send. Shift+Enter for a new line.</span>
          <button type="submit" disabled={pending}>
            {pending ? "Sending..." : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}
