import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

import JsonPreview from "./json-preview";
import { isPlainRecord } from "../../utils/approvals-parsers";

export interface EditApprovalModalProps {
  readonly open: boolean;
  readonly approvalSummary: string;
  readonly initialContent: Readonly<Record<string, unknown>>;
  readonly onClose: () => void;
  readonly onSubmit: (content: Readonly<Record<string, unknown>>) => void;
  readonly focusReturnRef?: RefObject<HTMLElement>;
}

function toEditableRecord(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  if (!isPlainRecord(value)) {
    return Object.freeze({}) as Readonly<Record<string, unknown>>;
  }
  return Object.freeze({ ...value });
}

function formatInitialText(value: Readonly<Record<string, unknown>>): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

export default function EditApprovalModal({ open, approvalSummary, initialContent, onClose, onSubmit, focusReturnRef }: EditApprovalModalProps) {
  const stableInitial = useMemo(() => toEditableRecord(initialContent), [initialContent]);
  const [draft, setDraft] = useState<string>(() => formatInitialText(stableInitial));
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Readonly<Record<string, unknown>> | null>(() => stableInitial);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const wasOpenRef = useRef<boolean>(open);

  useEffect(() => {
    if (!open) return;
    setDraft(formatInitialText(stableInitial));
    setParsed(stableInitial);
    setError(null);
  }, [open, stableInitial]);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!wasOpenRef.current) {
      wasOpenRef.current = open;
      return;
    }
    if (!open && focusReturnRef?.current) {
      requestAnimationFrame(() => {
        focusReturnRef.current?.focus();
      });
    }
    wasOpenRef.current = open;
  }, [focusReturnRef, open]);

  const handleChange = (value: string) => {
    setDraft(value);
    try {
      const next = JSON.parse(value);
      if (!isPlainRecord(next)) {
        setError("Edited content must be a JSON object.");
        setParsed(null);
        return;
      }
      setParsed(Object.freeze({ ...next }));
      setError(null);
    } catch (parseError) {
      setError((parseError as Error)?.message ?? "Invalid JSON payload");
      setParsed(null);
    }
  };

  const handleSubmit = () => {
    if (!parsed) {
      setError("Provide a valid JSON object before applying edits.");
      return;
    }
    onSubmit(parsed);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content approval-edit-modal" aria-describedby="approval-edit-help">
          <div className="modal-header">
            <Dialog.Title asChild>
              <h2>Edit approval payload</h2>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="close-button" aria-label="Close"><X size={16} /></button>
            </Dialog.Close>
          </div>

          <div className="approval-edit-modal__body">
            <p id="approval-edit-help" className="sr-only">Edit JSON payload to override tool arguments before applying the approval.</p>
            <p className="approval-edit-modal__summary" aria-live="polite">{approvalSummary}</p>
            <label className="approval-edit-modal__label" htmlFor="approval-edit-json">
              JSON overrides
              <textarea
                id="approval-edit-json"
                className="approval-edit-modal__editor"
                value={draft}
                onChange={(event) => handleChange(event.currentTarget.value)}
                spellCheck={false}
                ref={textareaRef}
              />
            </label>
            {error ? <div className="approval-edit-modal__error" role="alert">{error}</div> : null}
            <div className="approval-edit-modal__preview">
              <h3>Preview payload</h3>
              <JsonPreview value={parsed ?? {}} />
            </div>
          </div>

          <div className="approval-edit-modal__actions">
            <button type="button" className="cancel-button" onClick={onClose}>Cancel</button>
            <button type="button" className="apply-button" onClick={handleSubmit} disabled={!parsed}>Apply edits</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
