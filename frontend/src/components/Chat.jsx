import { useEffect, useRef, useState } from "react";
import Message from "./Message";

function WheelIcon({ size = 28, spinning = false }) {
  return (
    <svg
      className={`wheel-icon${spinning ? " wheel-icon--spinning" : ""}`}
      width={size}
      height={size}
      viewBox="17 17 130 130"
      fill="none"
    >
      <circle cx="82" cy="82" r="59" stroke="currentColor" strokeWidth="10"/>
      <path d="M82 43V62" stroke="currentColor" strokeWidth="8" strokeLinecap="round"/>
      <path d="M82 102V121" stroke="currentColor" strokeWidth="8" strokeLinecap="round"/>
      <path d="M43 82H62" stroke="currentColor" strokeWidth="8" strokeLinecap="round"/>
      <path d="M102 82H121" stroke="currentColor" strokeWidth="8" strokeLinecap="round"/>
      <path d="M54.4 54.4L67.8 67.8" stroke="currentColor" strokeWidth="8" strokeLinecap="round"/>
      <path d="M96.2 96.2L109.6 109.6" stroke="currentColor" strokeWidth="8" strokeLinecap="round"/>
      <path d="M109.6 54.4L96.2 67.8" stroke="currentColor" strokeWidth="8" strokeLinecap="round"/>
      <path d="M67.8 96.2L54.4 109.6" stroke="currentColor" strokeWidth="8" strokeLinecap="round"/>
      <circle cx="82" cy="82" r="20" fill="none" stroke="currentColor" strokeWidth="7"/>
      <circle cx="82" cy="82" r="6.5" fill="currentColor"/>
    </svg>
  );
}

export default function Chat({ messages, pending, onSend, currentUser }) {
  const [input, setInput] = useState("");
  const threadRef = useRef(null);
  const submitLockRef = useRef(false);
  const textareaRef = useRef(null);

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
            <p className="chat__empty-shortcut">
              <kbd>Ctrl</kbd> + <kbd>T</kbd> to start a new chat
            </p>
            <div className="chat__suggestions">
              <button type="button" onClick={() => { setInput("Explain quantum computing in simple terms"); textareaRef.current?.focus(); }}>
                Explain quantum computing
              </button>
              <button type="button" onClick={() => { setInput("Write a Python function to merge two sorted lists"); textareaRef.current?.focus(); }}>
                Merge sorted lists in Python
              </button>
              <button type="button" onClick={() => { setInput("What are the pros and cons of microservices?"); textareaRef.current?.focus(); }}>
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
            <div className="message__bubble message__bubble--assistant message__bubble--loading" />
          </div>
        ) : null}
      </div>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="composer__box">
          <WheelIcon size={22} spinning={pending} />
          <textarea
            ref={textareaRef}
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
        <div className="composer__footnote">
          <span className="composer__hallucination-note">AI models can hallucinate. Verify important info.</span>
        </div>
      </form>
    </div>
  );
}
