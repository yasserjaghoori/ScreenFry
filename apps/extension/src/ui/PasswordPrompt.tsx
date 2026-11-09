import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { send } from "@browser/messages";
import type { AppState } from "@shared/index";

/**
 * The first time someone changes a setting without a settings password, suggest one and
 * explain what it does. It is asked once (remembered in core state), never required:
 * "Not now" carries on with the change. "Set up password" drops the change and opens the
 * password form instead.
 */
let askedThisPage = false;
let openPasswordSetup = () => {
  // Pages without their own Settings view (the toolbar popup) open the dashboard there.
  void chrome.tabs.create({
    url: chrome.runtime.getURL("dashboard.html?setup=password#settings"),
  });
  window.close();
};
/** Lets the dashboard jump to its own password form instead of opening a new tab. */
export function setPasswordSetupHandler(handler: () => void) {
  openPasswordSetup = handler;
}

/** Resolves true when the change should go ahead. */
export async function passwordGate(state: AppState): Promise<boolean> {
  if (state.settingsPassword || state.passwordPromptSeen || askedThisPage) return true;
  askedThisPage = true;
  void send({ type: "PASSWORD_PROMPT_SEEN" });
  const choice = await new Promise<"setup" | "later">((resolve) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const previous = document.activeElement as HTMLElement | null;
    root.render(
      <PasswordPrompt
        onDone={(c) => {
          root.unmount();
          host.remove();
          previous?.focus?.();
          resolve(c);
        }}
      />,
    );
  });
  if (choice === "setup") {
    openPasswordSetup();
    return false;
  }
  return true;
}

const Lock = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5" />
  </svg>
);

function PasswordPrompt({ onDone }: { onDone: (choice: "setup" | "later") => void }) {
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primary.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onDone("later");
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onDone]);
  return (
    <div className="password-prompt-backdrop">
      <section
        className="password-prompt"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="password-prompt-title"
        aria-describedby="password-prompt-lead"
      >
        <span className="password-prompt-icon">
          <Lock />
        </span>
        <h2 id="password-prompt-title">Lock your settings with a password</h2>
        <p id="password-prompt-lead" className="password-prompt-lead">
          Right now anyone, including you in a weak moment, can undo a block in
          two clicks. A settings password puts a pause between the urge and
          the feed.
        </p>
        <ul className="password-prompt-points">
          <li>
            <strong>Asks before any change.</strong> Unblocking a site, raising
            a limit, editing windows or turning off feed blocking all need the
            password.
          </li>
          <li>
            <strong>Hand it to someone you trust</strong> if you want real
            accountability, or keep it yourself as a speed bump.
          </li>
          <li>
            <strong>Never adds time.</strong> Your limits still count, and you
            can change or remove the password later in Settings.
          </li>
          <li>
            <strong>Stays on this browser.</strong> There’s no account and no
            recovery, so keep it somewhere safe.
          </li>
        </ul>
        <div className="password-prompt-actions">
          <button type="button" className="button secondary" onClick={() => onDone("later")}>
            Not now
          </button>
          <button
            ref={primary}
            type="button"
            className="button"
            onClick={() => onDone("setup")}
          >
            Set up password
          </button>
        </div>
        <p className="password-prompt-foot">
          We’ll only ask once. “Not now” goes ahead with your change.
        </p>
      </section>
    </div>
  );
}
