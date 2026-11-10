import React, { useState } from "react";
import { send } from "@browser/messages";
import { defaultRules, launchSites } from "@core/sites";
import { siteDefinitions } from "@feeds/index";
import { hostMatchesDomain } from "@core/domains";
import type { AppState, FeedSite, WebsiteRule } from "@shared/index";
import { formatDuration } from "./format";
import { siteStatus } from "./siteStatus";
import { FryTimeBar } from "./FryTime";
import { confirmLoosen, loosenQuestion } from "./ConfirmLoosen";
import { passwordGate } from "./PasswordPrompt";
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
type ShortsChoice = "allow" | "links" | "block";
const SHORTS_CHOICES: { value: ShortsChoice; label: string; detail: (noun: string) => string }[] = [
  { value: "allow", label: "Allowed", detail: () => "No changes" },
  { value: "links", label: "From links only", detail: () => "Research mode: one at a time" },
  { value: "block", label: "Blocked", detail: (noun) => `No ${noun} at all` },
];
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
    if (!(await passwordGate(state))) return;
    setBusy(true);
    const result = await send<AppState>({
      type: "SAVE_RULE",
      rule: { ...rule, ...patch, enabled: true },
    });
    setBusy(false);
    if (result.ok) onState(result.data);
    else onError(result.error);
  }
  /** Ask before giving more time: removing a limit or raising it. */
  async function saveLimit(minutes: number | undefined) {
    if (!(await passwordGate(state))) return false;
    const loosens =
      current !== undefined && (minutes === undefined || minutes > current);
    if (
      loosens &&
      !(await confirmLoosen(
        minutes === undefined
          ? `Remove your ${definition.name} time limit?`
          : `Give yourself more ${definition.name} time?`,
        `Your limit is ${current} minute${current === 1 ? "" : "s"} a day.`,
      ))
    )
      return false;
    await saveRule({
      dailyAllowance:
        minutes === undefined ? undefined : { defaultMinutes: minutes },
    });
    return true;
  }
  async function toggleBlocked() {
    if (!(await passwordGate(state))) return;
    if (
      rule.blocked &&
      !(await confirmLoosen(`Unblock ${definition.name}?`))
    )
      return;
    await saveRule({ blocked: !rule.blocked });
  }
  async function toggle(key: string) {
    if (!(await passwordGate(state))) return;
    const on = state.feedSettings.sites[site]?.[key] === true;
    const element = definition.elements[key];
    // Research mode under a "block entirely" switch loosens that block when turned on.
    const loosens = element.requires ? !on : on;
    if (loosens) {
      const shortForm = definition.shortForm;
      const question = element.requires
        ? `Let ${shortForm?.label ?? "videos"} opened from links play again?`
        : shortForm?.setting === key
          ? `Are you sure you want to start watching ${shortForm.label} again?`
          : loosenQuestion(element.label, definition.name);
      if (!(await confirmLoosen(question))) return;
    }
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
  // Short-form video: Allowed, From links only (research mode) or Blocked.
  const research = definition.research;
  const feedsHere = state.feedSettings.sites[site] ?? {};
  const shortsChoice: ShortsChoice = !research?.requires || !feedsHere[research.requires]
    ? "allow"
    : feedsHere[research.setting]
      ? "links"
      : "block";
  const shortsNoun = (definition.shortForm?.label ?? "videos").replace(`${definition.name} `, "");
  async function chooseShorts(choice: ShortsChoice) {
    if (!research?.requires || choice === shortsChoice) return;
    if (!(await passwordGate(state))) return;
    const strictness = { allow: 0, links: 1, block: 2 };
    if (
      strictness[choice] < strictness[shortsChoice] &&
      !(await confirmLoosen(
        choice === "allow"
          ? `Are you sure you want to start watching ${definition.shortForm?.label} again?`
          : `Let ${definition.shortForm?.label} opened from links play again?`,
      ))
    )
      return;
    setBusy(true);
    const next = structuredClone(state.feedSettings);
    next.sites[site][research.requires] = choice !== "allow";
    next.sites[site][research.setting] = choice === "links";
    const result = await send<AppState>({ type: "SET_FEEDS", feedSettings: next });
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
      {status.fryTime && <FryTimeBar fry={status.fryTime} site={definition.name} />}
      <section className="control-section">
        <h3>Essentials</h3>
        <div className="control-group">
          <div className="control-row">
            <span>Block {definition.name}</span>
            <Switch
              label={`Block ${definition.name}`}
              checked={rule.blocked}
              disabled={busy}
              onChange={() => void toggleBlocked()}
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
                void saveLimit(
                  e.target.value === "none"
                    ? undefined
                    : Number(e.target.value),
                );
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
                void saveLimit(Number(custom)).then(
                  (saved) => saved && setCustomOpen(false),
                );
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
              // Research mode and "block entirely" are one three-way choice below.
              .filter(([key, element]) => !element.requires && key !== research?.requires)
              .map(([key, element]) => (
                <div className={`control-row${element.note ? " noted" : ""}`} key={key}>
                  <span>
                    {element.label}
                    {element.note && <small className="control-row-note">{element.note}</small>}
                  </span>
                  <Switch
                    label={element.label}
                    checked={state.feedSettings.sites[site]?.[key] === true}
                    disabled={busy}
                    onChange={() => void toggle(key)}
                  />
                </div>
              ))}
            {research?.requires &&
              definition.shortForm &&
              definition.elements[research.requires].group === group && (
                <div className="control-row shorts-choice">
                  <span>{definition.shortForm.label}</span>
                  <div className="segmented" role="radiogroup" aria-label={definition.shortForm.label}>
                    {SHORTS_CHOICES.map((choice) => (
                      <button
                        key={choice.value}
                        type="button"
                        role="radio"
                        aria-checked={shortsChoice === choice.value}
                        className={shortsChoice === choice.value ? "selected" : ""}
                        disabled={busy}
                        onClick={() => void chooseShorts(choice.value)}
                      >
                        {choice.label}
                        <span>{choice.detail(shortsNoun)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
          </div>
          {group === "Short-form video" && definition.shortForm && (
            <p className="control-note">
              {shortsChoice === "links"
                ? `From links only: a ${shortsNoun.replace(/s$/, "")} opened from a link plays, but you can’t scroll on to the next one or open its creator’s page. Load the page again to open another link. ${shortsNoun} shelves and buttons stay hidden.`
                : `Blocked stops playback entirely, including direct links, notifications and in-site navigation.`}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
