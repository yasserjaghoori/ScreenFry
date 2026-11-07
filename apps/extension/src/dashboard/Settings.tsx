import React, { useState } from "react";
import { send, setSettingsCredential } from "@browser/messages";
import type { AppState } from "@shared/index";
import { launchSites } from "@core/sites";
import { hostMatchesDomain } from "@core/domains";
import { Switch } from "../ui/SiteControls";
import { PrivateAccessGuide } from "../ui/PrivateAccessGuide";
import type { Notice } from "./index";
export function Settings({
  state,
  onState,
  onNotice,
  onUnlocked,
}: {
  state: AppState;
  onState: (s: AppState) => void;
  onNotice: (n: Notice) => void;
  onUnlocked: () => void;
}) {
  const [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false);
  async function savePassword(value: string) {
    if (value && value !== confirmation)
      return onNotice({ kind: "error", text: "The passwords do not match." });
    setBusy(true);
    const r = await send<AppState>({
      type: "SET_SETTINGS_PASSWORD",
      newPassword: value,
    });
    setBusy(false);
    if (!r.ok) return onNotice({ kind: "error", text: r.error });
    setSettingsCredential(value || undefined);
    onState(r.data);
    onUnlocked();
    setEditing(false);
    setPassword("");
    setConfirmation("");
    onNotice({
      kind: "success",
      text: value
        ? "Settings password saved."
        : "Password protection turned off.",
    });
  }
  const otherRules = state.rules.filter(
    (r) =>
      !launchSites.some((site) =>
        r.domains.some((d) => hostMatchesDomain(site.domain, d)),
      ),
  );
  return (
    <div className="settings-content">
      <section className="card settings-block">
        <h2>Password protection</h2>
        <p className="muted">
          Optional. Protect changes to website controls, limits and windows. A
          password never grants extra website time.
        </p>
        <div className="setting-row">
          <span>
            {state.settingsPassword
              ? "Password protection is on"
              : "Password protection is off"}
          </span>
          <button
            className="button secondary"
            onClick={() => setEditing(!editing)}
          >
            {state.settingsPassword ? "Change password" : "Set a password"}
          </button>
        </div>
        {editing && (
          <form
            className="password-form"
            onSubmit={(e) => {
              e.preventDefault();
              void savePassword(password);
            }}
          >
            <label className="field">
              New password
              <input
                type="password"
                autoComplete="new-password"
                minLength={4}
                maxLength={128}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="field">
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </label>
            <p className="muted small">
              Keep it somewhere safe. There is no password recovery service.
            </p>
            <button className="button" disabled={busy}>
              Save password
            </button>
          </form>
        )}
        {state.settingsPassword && (
          <button
            className="button ghost danger"
            disabled={busy}
            onClick={() => void savePassword("")}
          >
            Turn off password protection
          </button>
        )}
      </section>
      <section className="card settings-block">
        <h2>Website controls</h2>
        <div className="setting-row">
          <div>
            <strong>Feed and button blocking</strong>
            <p className="muted small">
              Applies your individual website toggles, including Shorts and
              Reels blocking.
            </p>
          </div>
          <Switch
            label="Feed and button blocking"
            checked={state.feedSettings.globalEnabled}
            onChange={async () => {
              const r = await send<AppState>({
                type: "SET_FEEDS",
                feedSettings: {
                  ...state.feedSettings,
                  globalEnabled: !state.feedSettings.globalEnabled,
                },
              });
              if (r.ok) onState(r.data);
              else onNotice({ kind: "error", text: r.error });
            }}
          />
        </div>
        <div className="setting-row">
          <div>
            <strong>Time-limit warnings</strong>
            <p className="muted small">
              A reminder with 5 minutes and 1 minute left.
            </p>
          </div>
          <Switch
            label="Time-limit warnings"
            checked={state.warningsEnabled}
            onChange={async () => {
              const r = await send<AppState>({
                type: "SET_PREFERENCES",
                warningsEnabled: !state.warningsEnabled,
              });
              if (r.ok) onState(r.data);
              else onNotice({ kind: "error", text: r.error });
            }}
          />
        </div>
      </section>
      <section className="card settings-block">
        <h2>Private browsing</h2>
        <p className="muted">
          Allow Screentime in private windows if you want your controls to apply
          there too.
        </p>
        <PrivateAccessGuide
          protection={state.protection}
          onCheck={async () => {
            const r = await send<AppState>({ type: "REFRESH_PROTECTION" });
            if (r.ok) onState(r.data);
          }}
        />
      </section>
      {otherRules.length > 0 && (
        <section className="card settings-block">
          <h2>Other saved website limits</h2>
          <p className="muted">Limits retained from previous settings.</p>
          {otherRules.map((rule) => (
            <div className="setting-row" key={rule.id}>
              <span>
                {rule.label} · {rule.dailyAllowance?.defaultMinutes ?? "No"}{" "}
                daily minutes
              </span>
              <button
                className="button secondary"
                onClick={async () => {
                  const r = await send<AppState>({
                    type: "DELETE_RULE",
                    ruleId: rule.id,
                  });
                  if (r.ok) onState(r.data);
                  else onNotice({ kind: "error", text: r.error });
                }}
              >
                Remove limit
              </button>
            </div>
          ))}
        </section>
      )}
      <section className="card settings-block">
        <h2>On this browser</h2>
        <p className="muted">
          Time counts on the focused tab and while audio or video plays in the
          background. An inactive, non-playing tab does not count. Each website
          is counted once, even with multiple tabs playing.
        </p>
        <p className="muted">
          Settings and usage stay in this browser. Chrome and Safari have
          separate allowances. There are no accounts or analytics.
        </p>
      </section>
    </div>
  );
}
