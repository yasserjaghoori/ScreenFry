import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

/**
 * A playful "are you sure?" before loosening a restriction you set on yourself. It adds
 * friction only: the setting change itself still goes through core actions and the optional
 * settings password, and nothing is enforced here.
 *
 * - First ask: the Yes button jumps away the first time you reach for it (hover, tap or
 *   keyboard), then springs back and can be clicked.
 * - Second ask ("Are you sure?"): the first click bounces off Yes, then the next one counts.
 */
export function confirmLoosen(question: string, detail?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const previous = document.activeElement as HTMLElement | null;
    const done = (yes: boolean) => {
      root.unmount();
      host.remove();
      previous?.focus?.();
      resolve(yes);
    };
    root.render(<LoosenDialog question={question} detail={detail} onDone={done} />);
  });
}

type Motion = "idle" | "dodge" | "deflect";
const DODGE_MS = 850;
const DEFLECT_MS = 750;

function LoosenDialog({
  question,
  detail,
  onDone,
}: {
  question: string;
  detail?: string;
  onDone: (yes: boolean) => void;
}) {
  const [stage, setStage] = useState<"ask" | "really">("ask");
  const [dodged, setDodged] = useState(false);
  const [deflected, setDeflected] = useState(false);
  const [motion, setMotion] = useState<Motion>("idle");
  const [side, setSide] = useState<1 | -1>(1);
  const [spark, setSpark] = useState<{ x: number; y: number; key: number }>();
  const no = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    no.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onDone(false);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      clearTimeout(timer.current);
    };
  }, [onDone]);

  function play(next: Motion, ms: number) {
    // Yes sits on the right, so it dodges left, leapfrogging No, to stay inside the dialog.
    setSide(next === "dodge" || Math.random() < 0.5 ? -1 : 1);
    setMotion(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMotion("idle"), ms);
  }
  function dodge() {
    if (stage !== "ask" || dodged || motion !== "idle") return;
    setDodged(true);
    play("dodge", DODGE_MS);
  }
  function clickYes(e: React.MouseEvent<HTMLButtonElement>) {
    if (motion !== "idle") return;
    if (stage === "ask") {
      // Touch and keyboard never hover, so their first try is the one that gets dodged.
      if (!dodged) return dodge();
      setStage("really");
      return;
    }
    if (!deflected) {
      setDeflected(true);
      const box = e.currentTarget.getBoundingClientRect();
      // Keyboard clicks have no pointer position; bounce off the button's centre instead.
      const x = e.clientX || box.left + box.width / 2;
      const y = e.clientY || box.top + box.height / 2;
      setSpark({ x, y, key: Date.now() });
      play("deflect", DEFLECT_MS);
      return;
    }
    onDone(true);
  }

  const really = stage === "really";
  return (
    <div
      className="loosen-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onDone(false)}
    >
      <section
        className={`loosen-dialog ${really ? "is-really" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="loosen-title"
        aria-describedby="loosen-detail"
      >
        <span className="loosen-emoji" aria-hidden="true">
          {really ? "🤨" : "🍟"}
        </span>
        <h2 id="loosen-title">{really ? "Are you sure?" : question}</h2>
        <p id="loosen-detail" className="muted">
          {really
            ? "Like, really sure? Past you turned this on for a reason."
            : (detail ?? "You set this up to protect your time.")}
        </p>
        <div className="loosen-actions">
          <button ref={no} type="button" className="button" onClick={() => onDone(false)}>
            {really ? "No, you’re right" : "No, keep it"}
          </button>
          <button
            type="button"
            className={`button secondary loosen-yes ${motion !== "idle" ? `is-${motion}` : ""}`}
            style={{ "--side": side } as React.CSSProperties}
            aria-disabled={motion !== "idle"}
            onPointerEnter={(e) => e.pointerType === "mouse" && dodge()}
            onClick={clickYes}
          >
            {really ? "Yes, I’m sure" : "Yes"}
            {motion !== "idle" && (
              <span className="loosen-bubble" aria-hidden="true">
                {motion === "dodge" ? "nope!" : "boing!"}
              </span>
            )}
          </button>
        </div>
        <p className="loosen-status" role="status">
          {motion === "dodge"
            ? "The Yes button dodged you. Try again."
            : motion === "deflect"
              ? "Your click bounced off. Try once more if you mean it."
              : ""}
        </p>
      </section>
      {spark && motion === "deflect" && (
        <span
          key={spark.key}
          className="loosen-spark"
          aria-hidden="true"
          style={
            {
              left: spark.x,
              top: spark.y,
              "--side": side,
            } as React.CSSProperties
          }
        />
      )}
    </div>
  );
}

/** "Hide home feed" → "Bring back the home feed?", "Block Shorts entirely" → "Unblock Shorts?" */
export function loosenQuestion(label: string, site: string): string {
  const hide = /^Hide (.+)$/i.exec(label);
  if (hide) {
    const what = hide[1].replace(/^(the )?/i, "");
    return `Bring back the ${what} on ${site}?`;
  }
  const block = /^Block (.+?)( entirely)?$/i.exec(label);
  if (block) return `Unblock ${block[1]} on ${site}?`;
  return `Turn off “${label}” on ${site}?`;
}
