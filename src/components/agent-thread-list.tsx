import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import "./agent-thread-list.css";

type ThreadItem = {
  sessionId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  filePath: string;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onOpenThread: (sessionId: string) => void;
  onDeleteThread?: (sessionId: string) => void;
  currentSessionId?: string | null;
  refreshKey?: number;
  workspaceId?: string;
};

export default function AgentThreadList({ isOpen, onClose, onOpenThread, onDeleteThread, currentSessionId, refreshKey = 0, workspaceId }: Props) {
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [loading, setLoading] = useState(false);

  async function fetchThreads() {
    setLoading(true);
    try {
      const res: any = await (window as any).electron?.ipcRenderer?.invoke?.('agent:threads:list', workspaceId ? { workspaceId } : {});
      const items: ThreadItem[] = (res && res.success) ? (res.data?.threads || []) : (res?.threads || res?.data || []);
      setThreads(Array.isArray(items) ? items : []);
    } catch {
      setThreads([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    fetchThreads();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, refreshKey, workspaceId]);

  return (
    <Dialog.Root open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content workspace-modal agent-threads-modal" aria-describedby={undefined}>
          <div className="modal-header">
            <Dialog.Title asChild>
              <h2>Chats</h2>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="close-button" aria-label="Close">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="modal-body">
            {loading ? (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Loading…</div>
            ) : threads.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No chats yet. Click “New Chat” to start one.</div>
            ) : (
              <div className="agent-threads-list">
                {threads.map((t) => (
                  <div key={t.sessionId} className={`thread-row ${t.sessionId === currentSessionId ? 'active' : ''}`}>
                    <button
                      className="secondary"
                      style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      onClick={() => onOpenThread(t.sessionId)}
                      title={`${t.title} — ${t.messageCount} messages`}
                    >
                      {t.title || 'Untitled'}
                    </button>
                    <span className="thread-updated-at">{new Date(t.updatedAt).toLocaleString()}</span>
                    <button className="cancel-button" title="Delete" aria-label="Delete" onClick={() => onDeleteThread?.(t.sessionId)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
