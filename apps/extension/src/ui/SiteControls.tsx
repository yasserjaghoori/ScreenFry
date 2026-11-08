import React, { useState } from "react";
import { send } from "@browser/messages";
import { defaultRules, launchSites } from "@core/sites";
import { siteDefinitions } from "@feeds/index";
import { hostMatchesDomain } from "@core/domains";
import type { AppState, FeedSite, WebsiteRule } from "@shared/index";
import { formatDuration } from "./format";
import { siteStatus } from "./siteStatus";
export function Switch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      className={`switch ${checked ? "on" : ""}`}
      onClick={onChange}
    />
  );
}
export function SiteControls({
  state,
  site,
  onState,
  onError,
}: {
  state: AppState;
  site: FeedSite;
  onState: (state: AppState) => void;
  onError: (text: string) => void;
}) {
  const definition = siteDefinitions.find((s) => s.site === site)!;
  const info = launchSites.find((s) => s.id === site)!;
  const rule =
    state.rules.find((r) =>
      r.domains.some((d) => hostMatchesDomain(info.domain, d)),
    ) ?? defaultRules().find((r) => r.id === site)!;
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState(
    String(rule.dailyAllowance?.defaultMinutes ?? 15),
  );
  const presets = [0, 1, 5, 10, 15, 30, 45, 60, 90, 120];
  const current = rule.dailyAllowance?.defaultMinutes;
  const [customOpen, setCustomOpen] = useState(false);
  async function saveRule(patch: Partial<WebsiteRule>) {
    setBusy(true);
    const result = await send<AppState>({
      type: "SAVE_RULE",
      rule: { ...rule, ...patch, enabled: true },
    });
    setBusy(false);
    if (result.ok) onState(result.data);
    else onError(result.error);
  }
  async function toggle(key: string) {
    setBusy(true);
    const next = structuredClone(state.feedSettings);
    next.sites[site][key] = !next.sites[site][key];
    const result = await send<AppState>({
      type: "SET_FEEDS",
      feedSettings: next,
    });
    setBusy(false);
    if (result.ok) onState(result.data);
    else onError(result.error);
  }
  const status = siteStatus(state, site);
  const groups = [
    ...new Set(Object.values(definition.elements).map((e) => e.group)),
  ];
  return (
    <div className="site-controls">
      <div className="site-summary">
        <div className="site-avatar" style={{ background: info.color }}>
          {info.symbol}
        </div>
        <div className="site-summary-text">
          <div className="site-summary-title">
            <h2>{definition.name}</h2>
            <span className={`pill ${status.blocked ? "warn" : "good"}`}>
              {status.blocked ? "Blocked now" : "Available"}
            </span>
          </div>
          <p className="muted small">
            {formatDuration(status.usedMs)} used today
            {status.limitMinutes !== undefined &&
              ` · ${status.limitMinutes ? formatDuration(status.limitMinutes * 60_000) : "0m"} daily limit`}
          </p>
          {status.progress !== undefined && (
            <span className="meter large" aria-hidden="true">
              <span style={{ width: `${status.progress * 100}%` }} />
            </span>
          )}
        </div>
      </div>
      <section className="control-section">
        <h3>Essentials</h3>
        <div className="control-group">
          <div className="control-row">
            <span>Block {definition.name}</span>
            <Switch
              label={`Block ${definition.name}`}
              checked={rule.blocked}
              disabled={busy}
              onChange={() => void saveRule({ blocked: !rule.blocked })}
            />
          </div>
        </div>
      </section>
      <section className="control-section">
        <h3>Time limit</h3>
        <div className="control-group">
          <div className="control-row">
            <label htmlFor="daily-limit">Daily limit</label>
            <select
              id="daily-limit"
              aria-label={`${definition.name} daily limit`}
              disabled={busy}
              value={
                customOpen
                  ? "custom"
                  : current === undefined
                    ? "none"
                    : presets.includes(current)
                      ? String(current)
                      : "custom"
              }
              onChange={(e) => {
                if (e.target.value === "custom") {
                  setCustomOpen(true);
                  setCustom(String(current ?? 15));
                  return;
                }
                setCustomOpen(false);
                void saveRule({
                  dailyAllowance:
                    e.target.value === "none"
                      ? undefined
                      : { defaultMinutes: Number(e.target.value) },
                });
              }}
            >
              <option value="none">No limit</option>
              {presets.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "0 minutes · blocked" : `${n} minutes`}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
          </div>
          {(customOpen ||
            (current !== undefined && !presets.includes(current))) && (
            <form
              className="control-row"
              onSubmit={(e) => {
                e.preventDefault();
                void saveRule({
                  dailyAllowance: { defaultMinutes: Number(custom) },
                }).then(() => setCustomOpen(false));
              }}
            >
              <label htmlFor="custom-minutes">Minutes per day</label>
              <div className="row">
                <input
                  id="custom-minutes"
                  type="number"
                  min={0}
                  max={1440}
                  required
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                />
                <button className="button secondary" disabled={busy}>
                  Save
                </button>
              </div>
            </form>
          )}
          <div className="control-row">
            <span>Display timer on site</span>
            <Switch
              label="Display timer on site"
              checked={rule.showTimer}
              disabled={busy}
              onChange={() => void saveRule({ showTimer: !rule.showTimer })}
            />
          </div>
        </div>
        <p className="control-note">
          One daily allowance, shared across this site’s windows. Resets at
          midnight.
        </p>
      </section>
      {groups.map((group) => (
        <section className="control-section" key={group}>
          <h3>{group}</h3>
          <div className="control-group">
            {Object.entries(definition.elements)
              .filter(([, e]) => e.group === group)
              .map(([key, element]) => (
                <div className="control-row" key={key}>
                  <span>{element.label}</span>
                  <Switch
                    label={element.label}
                    checked={state.feedSettings.sites[site]?.[key] === true}
                    disabled={busy || !state.feedSettings.globalEnabled}
                    onChange={() => void toggle(key)}
                  />
                </div>
              ))}
          </div>
          {group === "Short-form video" && (
            <p className="control-note">
              Blocks playback too, including direct links, notifications and
              in-site navigation.
            </p>
          )}
        </section>
      ))}
      {!state.feedSettings.globalEnabled && (
        <p className="notice">
          Feed and button controls are paused. Enable them in Settings.
        </p>
      )}
    </div>
  );
}
