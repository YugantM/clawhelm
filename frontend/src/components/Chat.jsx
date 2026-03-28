import { useEffect, useRef, useState } from "react";
import Message from "./Message";
import ModelSelector from "./ModelSelector";

export default function Chat({ messages, pending, onSend, currentUser, models = [], selectedModel = "auto", onModelChange, onShowAllModels }) {
  const [input, setInput] = useState("");
  const threadRef = useRef(null);
  const submitLockRef = useRef(false);

  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  async function submit() {
    const value = input.trim();
    if (!value || pending || submitLockRef.current) return;
    submitLockRef.current = true;
    setInput("");
    try {
      await onSend(value);
    } finally {
      submitLockRef.current = false;
    }
  }

  const showModelSelector = models.length > 1;

  return (
    <div className="chat">
      <div className="chat__thread" ref={threadRef}>
        {messages.length === 0 ? (
          <div className="chat__empty">
            <h1 className="chat__empty-title"><span className="chat__empty-title--white">Claw</span><span className="chat__empty-title--gradient">Helm</span></h1>
            <p className="chat__empty-sub">
              {currentUser
                ? `Welcome back${currentUser.name ? `, ${currentUser.name}` : ""}. Ask anything.`
                : "Ask anything. The best model answers."}
            </p>
            {!currentUser && (
              <p className="chat__empty-guest-hint">
                Sign in to save your chat history across devices
              </p>
            )}
            <div className="chat__suggestions">
              <button type="button" onClick={() => { setInput("Explain quantum computing in simple terms"); }}>
                Explain quantum computing
              </button>
              <button type="button" onClick={() => { setInput("Write a Python function to merge two sorted lists"); }}>
                Merge sorted lists in Python
              </button>
              <button type="button" onClick={() => { setInput("What are the pros and cons of microservices?"); }}>
                Microservices pros &amp; cons
              </button>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <Message key={msg.id} role={msg.role} content={msg.content} meta={msg.meta} />
          ))
        )}
        {pending ? (
          <div className="message message--assistant">
            <div className="message__bubble message__bubble--assistant message__bubble--loading">
              <div className="typing-dots"><span /><span /><span /></div>
            </div>
          </div>
        ) : null}
      </div>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {showModelSelector && (
          <div className="composer__model-row">
            <ModelSelector
              models={models}
              selectedModel={selectedModel}
              onModelChange={onModelChange}
              onShowAllModels={onShowAllModels}
            />
          </div>
        )}
        <div className="composer__input-row">
          <textarea
            className="composer__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
            placeholder="Message ClawHelm..."
            rows={1}
          />
          <button type="submit" className="composer__send" disabled={pending || !input.trim()} aria-label="Send">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M3 10h14M11 4l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
