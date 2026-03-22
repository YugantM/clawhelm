import { useState } from "react";
import Message from "./Message";

export default function Chat({ messages, pending, onSend, selectedInsightId, onSelectInsight, modeLabel }) {
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
                : "Send prompts through the same OpenAI-compatible proxy the rest of the system uses."}
          </p>
        </div>
      </div>

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
