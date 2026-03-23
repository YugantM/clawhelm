import MessageMetaTooltip from "./MessageMetaTooltip";

function formatMetaLabel(role) {
  return role === "user" ? "You" : "Clawhelm";
}

export default function Message({ role, content, insight, active, onSelect }) {
  return (
    <div className={`message-row message-row--${role}`}>
      <div
        role={insight ? "button" : undefined}
        tabIndex={insight ? 0 : undefined}
        className={`message-bubble message-bubble--${role} ${active ? "message-bubble--active" : ""}`}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (!insight) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
      >
        <span className="message-bubble__meta">{formatMetaLabel(role)}</span>
        <p>{content}</p>
        {role === "assistant" ? (
          <div className="message-bubble__foot">
            <MessageMetaTooltip insight={insight || {}} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
