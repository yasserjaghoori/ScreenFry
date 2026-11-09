import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

/** A plain yes/no question (no dodging), e.g. "Close without saving?". Escape answers no. */
export function confirmDialog({
  question,
  detail,
  yes,
  no,
}: {
  question: string;
  detail?: string;
  yes: string;
  no: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const previous = document.activeElement as HTMLElement | null;
    const done = (answer: boolean) => {
      root.unmount();
      host.remove();
      previous?.focus?.();
      resolve(answer);
    };
    root.render(<Dialog question={question} detail={detail} yes={yes} no={no} onDone={done} />);
  });
}

function Dialog({
  question,
  detail,
  yes,
  no,
  onDone,
}: {
  question: string;
  detail?: string;
  yes: string;
  no: string;
  onDone: (answer: boolean) => void;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keep.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Answer only this dialog, not whatever is open underneath it.
      e.stopPropagation();
      onDone(false);
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [onDone]);
  return (
    <div
      className="loosen-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onDone(false)}
    >
      <section
        className="loosen-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-detail"
      >
        <h2 id="confirm-title">{question}</h2>
        {detail && (
          <p id="confirm-detail" className="muted">
            {detail}
          </p>
        )}
        <div className="loosen-actions">
          <button ref={keep} type="button" className="button secondary" onClick={() => onDone(false)}>
            {no}
          </button>
          <button type="button" className="button danger-fill" onClick={() => onDone(true)}>
            {yes}
          </button>
        </div>
      </section>
    </div>
  );
}
