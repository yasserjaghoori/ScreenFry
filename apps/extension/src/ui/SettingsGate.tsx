import React, { useState } from "react";
import { send, setSettingsCredential } from "@browser/messages";
import type { AppState } from "@shared/index";
export function SettingsGate({
  state,
  unlocked,
  onUnlock,
  children,
}: {
  state: AppState;
  unlocked: boolean;
  onUnlock: () => void;
  children: React.ReactNode;
}) {
  const [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (!state.settingsPassword || unlocked) return <>{children}</>;
  return (
    <section className="card settings-block password-gate">
      <h2>Settings are protected</h2>
      <p className="muted">
        Enter your password to change website controls, limits or windows.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const result = await send<AppState>({
            type: "UNLOCK_SETTINGS",
            password,
          });
          setBusy(false);
          if (!result.ok) {
            setPassword("");
            return setError(result.error);
          }
          setSettingsCredential(password);
          setPassword("");
          setError("");
          onUnlock();
        }}
      >
        <label className="field">
          Settings password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="button" disabled={busy}>
          {busy ? "Checking…" : "Unlock settings"}
        </button>
      </form>
    </section>
  );
}
