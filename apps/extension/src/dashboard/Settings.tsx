import React, { useEffect, useRef, useState } from "react";
import { send, setSettingsCredential } from "@browser/messages";
import type { AppState } from "@shared/index";
import { launchSites } from "@core/sites";
import { hostMatchesDomain } from "@core/domains";
import { Switch } from "../ui/SiteControls";
import { confirmLoosen } from "../ui/ConfirmLoosen";
import { passwordGate } from "../ui/PasswordPrompt";
import { PrivateAccessGuide } from "../ui/PrivateAccessGuide";
import { clearTimeFormatPreference } from "../ui/TimePicker";
import type { Notice } from "./index";
export function Settings({
  state,
  onState,
  onNotice,
  onUnlocked,
  openPasswordForm = 0,
}: {
  state: AppState;
  onState: (s: AppState) => void;
  onNotice: (n: Notice) => void;
  onUnlocked: () => void;
  /** Changes whenever the password form should open and come into view. */
  openPasswordForm?: number;
}) {
  const [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [highlight, setHighlight] = useState(false);
  const passwordSection = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!openPasswordForm || state.settingsPassword) return;
    setEditing(true);
    setHighlight(true);
    requestAnimationFrame(() => {
      passwordSection.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      passwordSection.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    });
    const timer = setTimeout(() => setHighlight(false), 2400);
    return () => clearTimeout(timer);
  }, [openPasswordForm]);
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
      <section
        ref={passwordSection}
        id="password-protection"
        className={`card settings-block password-block ${highlight ? "is-highlighted" : ""}`}
      >
        <h2>Password protection</h2>
        <p className="muted">
          Optional, and recommended. With a password, ScreenFry asks for it
          before anyone can unblock a site, raise a limit, edit windows or turn
          off feed blocking, so an impulse has to get past a pause first. Give
          it to someone you trust for real accountability. A password never
          grants extra website time.
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
              if (!(await passwordGate(state))) return;
              if (
                state.feedSettings.globalEnabled &&
                !(await confirmLoosen(
                  "Turn off all feed and button blocking?",
                  "Feeds, Shorts and Reels come back on every website.",
                ))
              )
                return;
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
              if (!(await passwordGate(state))) return;
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
          Allow ScreenFry in private windows if you want your controls to apply
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
                  if (!(await passwordGate(state))) return;
                  if (
                    rule.dailyAllowance &&
                    !(await confirmLoosen(`Remove your ${rule.label} limit?`))
                  )
                    return;
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
      <section className="card settings-block reset-block">
        <h2>Restore defaults</h2>
        <p className="muted">
          Erase everything ScreenFry keeps in this browser: websites, limits,
          windows, feed blocking, usage and the settings password. ScreenFry
          starts over as if it were just installed. Other browsers keep their
          own settings; the ScreenFry app can reset all of them at once.
        </p>
        <button
          className="button danger-fill"
          disabled={busy}
          onClick={async () => {
            if (!(await passwordGate(state))) return;
            if (
              !(await confirmLoosen(
                "Reset ScreenFry to its defaults?",
                "Every website setting, window, limit, all usage and the settings password are erased in this browser. This can’t be undone.",
              ))
            )
              return;
            setBusy(true);
            const r = await send<AppState>({ type: "RESET_ALL" });
            setBusy(false);
            if (!r.ok) return onNotice({ kind: "error", text: r.error });
            setSettingsCredential();
            clearTimeFormatPreference();
            setEditing(false);
            onState(r.data);
            onNotice({
              kind: "success",
              text: "ScreenFry is back to its defaults in this browser.",
            });
          }}
        >
          Reset all data
        </button>
      </section>
    </div>
  );
}
