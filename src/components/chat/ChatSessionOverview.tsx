import { MessageSquarePlus, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import i18n from "@/i18n";
import { useChatStore } from "@/store/useChatStore";

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

export function ChatSessionOverview() {
  const { t } = useTranslation();
  const sessions = useChatStore((state) => state.sessions);
  const openSession = useChatStore((state) => state.openSession);
  const deleteSession = useChatStore((state) => state.deleteSession);
  const newSession = useChatStore((state) => state.newSession);
  const closePanel = useChatStore((state) => state.closePanel);
  // Only one turn can be in flight at a time, and it always belongs to the
  // active session — so that one row gets the running indicator.
  const isStreaming = useChatStore((state) => state.isStreaming);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const runningSessionId = isStreaming ? activeSessionId : null;

  return (
    <div className="chat-overview">
      <header className="chat-panel__header">
        <h2 className="chat-panel__title">{t("chat.overviewTitle")}</h2>
        <button
          type="button"
          className="chat-panel__header-button"
          aria-label={t("chat.close")}
          title={t("chat.close")}
          onClick={closePanel}
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="chat-overview__actions">
        <Button
          type="button"
          size="sm"
          className="chat-overview__new"
          onClick={newSession}
        >
          <MessageSquarePlus className="size-4" />
          {t("chat.newSession")}
        </Button>
      </div>

      {sessions.length === 0 ? (
        <p className="chat-overview__empty">{t("chat.overviewEmpty")}</p>
      ) : (
        <ul className="chat-overview__list">
          {sessions.map((session) => (
            <li key={session.id} className="chat-overview__item">
              <button
                type="button"
                className="chat-overview__open"
                onClick={() => openSession(session.id)}
              >
                <span className="chat-overview__heading">
                  {session.id === runningSessionId ? (
                    <span
                      className="chat-overview__running"
                      role="status"
                      aria-label={t("chat.agentWorking")}
                      title={t("chat.agentWorking")}
                    >
                      <span className="chat-thinking-dots" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </span>
                    </span>
                  ) : null}
                  <span className="chat-overview__title">
                    {session.title || t("chat.untitledSession")}
                  </span>
                </span>
                <span className="chat-overview__meta">{formatTimestamp(session.updatedAt)}</span>
              </button>
              <button
                type="button"
                className="chat-overview__delete"
                aria-label={t("chat.deleteSession")}
                title={t("chat.deleteSession")}
                onClick={() => deleteSession(session.id)}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
