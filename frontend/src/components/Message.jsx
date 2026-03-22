function formatMetaLabel(role) {
  return role === "user" ? "You" : "Clawhelm";
}

export default function Message({ role, content, insight, active, onSelect }) {
  const scoreLabel = insight?.routing_score != null ? `score ${insight.routing_score.toFixed(3)}` : null;

  return (
    <div className={`message-row message-row--${role}`}>
      <button
        type="button"
        className={`message-bubble message-bubble--${role} ${active ? "message-bubble--active" : ""}`}
        onClick={onSelect}
      >
        <span className="message-bubble__meta">{formatMetaLabel(role)}</span>
        <p>{content}</p>
        {role === "assistant" && insight ? (
          <div className="message-bubble__foot">
            <span>{insight.model_display_name || insight.actual_model || insight.selected_model}</span>
            <span>{insight.provider || "unknown"}</span>
            {scoreLabel ? <span>{scoreLabel}</span> : null}
          </div>
        ) : null}
      </button>
    </div>
  );
}
