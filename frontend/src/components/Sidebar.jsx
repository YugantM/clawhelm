import { useState } from "react";

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function Sidebar({
  isOpen,
  onClose,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  currentUser,
  onLogout,
  onSignIn,
}) {
  const [confirmDelete, setConfirmDelete] = useState(null);

  function handleDelete(e, sessionId) {
    e.stopPropagation();
    if (confirmDelete === sessionId) {
      onDeleteSession(sessionId);
      setConfirmDelete(null);
    } else {
      setConfirmDelete(sessionId);
      setTimeout(() => setConfirmDelete(null), 3000);
    }
  }

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar ${isOpen ? "sidebar--open" : ""}`}>
        <div className="sidebar__header">
          <h2 className="sidebar__title">Chats</h2>
          <button className="sidebar__new-btn" onClick={onNewChat} title="New chat">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="sidebar__sessions">
          {!currentUser ? (
            <div className="sidebar__guest">
              <p>Sign in to save and access your chat history across devices.</p>
              <button className="sidebar__signin-btn" onClick={onSignIn}>Sign in</button>
            </div>
          ) : sessions.length === 0 ? (
            <div className="sidebar__empty">
              <p>No chats yet. Start a new conversation!</p>
            </div>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                className={`sidebar__session ${s.id === activeSessionId ? "sidebar__session--active" : ""}`}
                onClick={() => onSelectSession(s.id)}
              >
                <div className="sidebar__session-info">
                  <span className="sidebar__session-title">
                    {s.title || "New chat"}
                  </span>
                  <span className="sidebar__session-meta">
                    {formatDate(s.last_accessed_at || s.created_at)}
                    {s.message_count > 0 && ` · ${s.message_count} msgs`}
                  </span>
                </div>
                <button
                  className={`sidebar__delete-btn ${confirmDelete === s.id ? "sidebar__delete-btn--confirm" : ""}`}
                  onClick={(e) => handleDelete(e, s.id)}
                  title={confirmDelete === s.id ? "Click again to confirm" : "Delete chat"}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3 3l8 8M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </button>
            ))
          )}
        </div>

        {currentUser && (
          <div className="sidebar__footer">
            <div className="sidebar__user">
              {currentUser.avatar_url ? (
                <img className="sidebar__avatar" src={currentUser.avatar_url} alt="" />
              ) : (
                <div className="sidebar__avatar sidebar__avatar--placeholder">
                  {(currentUser.name || currentUser.email || "?")[0].toUpperCase()}
                </div>
              )}
              <div className="sidebar__user-info">
                <span className="sidebar__user-name">{currentUser.name || "User"}</span>
                <span className="sidebar__user-email">{currentUser.email}</span>
              </div>
            </div>
            <button className="sidebar__logout-btn" onClick={onLogout} title="Sign out">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6 14H3a1 1 0 01-1-1V3a1 1 0 011-1h3M11 11l3-3-3-3M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
