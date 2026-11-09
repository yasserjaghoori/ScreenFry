import React, { useEffect, useState } from "react";
import { send } from "@browser/messages";
import { launchSites } from "@core/sites";
import { expandDomainAliases, hostMatchesDomain, normalizeDomain } from "@core/domains";
import { exportSettings } from "@core/actions";
import {
  decodeShareCode,
  encodeShareCode,
  summarizeShared,
  websiteNames,
  type SharedSummary,
} from "@core/share";
import { earnRemaining, evaluatePolicy } from "@policy/index";
import type { AppState, EarnGoal } from "@shared/index";
import { Switch } from "../ui/SiteControls";
import { confirmLoosen } from "../ui/ConfirmLoosen";
import { confirmDialog } from "../ui/ConfirmDialog";
import { passwordGate } from "../ui/PasswordPrompt";
import type { Notice } from "./index";

/**
 * Experimental features: Earn your website time, and share codes for settings. Both change
 * settings only through background messages (core actions and the optional password).
 */
export function Experimental({
  state,
  onState,
  onNotice,
}: {
  state: AppState;
  onState: (s: AppState) => void;
  onNotice: (n: Notice) => void;
}) {
  return (
    <div className="settings-content experimental">
      <p className="experimental-note">
        <span className="pill experimental-pill">Experimental</span> Early features to try.
        They work, but how they look and behave may still change.
      </p>
      <EarnTime state={state} onState={onState} onNotice={onNotice} />
      <ShareSettings state={state} onState={onState} onNotice={onNotice} />
    </div>
  );
}

const supportedDomains = expandDomainAliases(launchSites.map((s) => s.domain));
const blankGoal = (): EarnGoal => ({
  id: crypto.randomUUID(),
  label: "",
  enabled: true,
  goalDomains: [],
  minutes: 30,
  lockedDomains: expandDomainAliases(["youtube.com", "instagram.com", "tiktok.com"]),
});
const listNames = (names: string[]) =>
  names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

function EarnTime({
  state,
  onState,
  onNotice,
}: {
  state: AppState;
  onState: (s: AppState) => void;
  onNotice: (n: Notice) => void;
}) {
  const goals = state.earnGoals ?? [];
  const [editing, setEditing] = useState<EarnGoal>();
  const [goalSite, setGoalSite] = useState("");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const now = Date.now();

  function edit(goal: EarnGoal) {
    setEditing(structuredClone(goal));
    setGoalSite(goal.goalDomains[0] ?? "");
    setCustom(goal.lockedDomains.filter((d) => !supportedDomains.includes(d)).join(", "));
    setError("");
  }
  useEffect(() => {
    if (!editing) return;
    const key = (e: KeyboardEvent) => {
      const prompt = document.querySelector('[aria-modal="true"]:not(.modal)');
      if (e.key === "Escape" && !prompt) setEditing(undefined);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [editing]);

  const editedGoal = (g: EarnGoal): EarnGoal => ({
    ...g,
    label: g.label.trim(),
    goalDomains: goalSite.trim() ? [goalSite.trim()] : [],
    lockedDomains: [
      ...g.lockedDomains.filter((d) => supportedDomains.includes(d)),
      ...custom.split(/[\s,]+/).filter(Boolean),
    ],
  });
  /** Less to earn or fewer locked websites lets you in sooner, so it asks first. */
  function loosens(before: EarnGoal | undefined, after: EarnGoal): boolean {
    if (!before?.enabled) return false;
    if (!after.enabled || after.minutes < before.minutes) return true;
    const kept = expandDomainAliases(after.lockedDomains.map(normalizeDomain));
    return before.lockedDomains.some((d) => !kept.includes(d));
  }
  async function save(goal: EarnGoal) {
    if (!(await passwordGate(state))) return;
    const before = goals.find((g) => g.id === goal.id);
    if (
      loosens(before, goal) &&
      !(await confirmLoosen(
        `Make “${before!.label}” easier?`,
        "Past you set this goal to earn your feeds first.",
      ))
    )
      return;
    setBusy(true);
    const r = await send<AppState>({ type: "SAVE_EARN_GOAL", goal });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      onNotice({ kind: "error", text: r.error });
      return false;
    }
    onState(r.data);
    setEditing(undefined);
    return true;
  }
  async function remove(goal: EarnGoal) {
    if (!(await passwordGate(state))) return;
    if (
      goal.enabled &&
      !(await confirmLoosen(
        `Delete “${goal.label}”?`,
        `${listNames(websiteNames(goal.lockedDomains))} would open without earning them first.`,
      ))
    )
      return;
    setBusy(true);
    const r = await send<AppState>({ type: "DELETE_EARN_GOAL", goalId: goal.id });
    setBusy(false);
    if (r.ok) onState(r.data);
    else onNotice({ kind: "error", text: r.error });
  }

  const goalDomain = normalizeDomain(goalSite);
  const goalBlocked =
    editing &&
    goalDomain &&
    evaluatePolicy(state, `https://${goalDomain}/`, now).status === "blocked";

  return (
    <section className="card settings-block earn">
      <div className="row spread">
        <h2>Earn your website time</h2>
        <button className="button" onClick={() => edit(blankGoal())}>
          Add a goal
        </button>
      </div>
      <p className="muted">
        Pick a website that’s good for you and how long to spend there each day. Until you
        have, the websites you choose stay blocked. They open as soon as the goal is met
        and lock again at midnight.
      </p>
      <p className="muted small">
        Time on the goal website counts like your limits do: the focused tab, or audio and
        video playing in the background.
      </p>
      {goals.length === 0 && (
        <div className="empty">
          <h3>Learn first, scroll later.</h3>
          <p>For example: 30 minutes on duolingo.com unlocks YouTube and Instagram.</p>
        </div>
      )}
      <div className="list">
        {goals.map((goal) => {
          const left = earnRemaining(state, goal, now);
          const earned = goal.minutes - Math.ceil(left / 60_000);
          const locked = websiteNames(goal.lockedDomains);
          const done = left === 0;
          return (
            <article
              key={goal.id}
              className={`earn-goal ${done ? "is-earned" : ""} ${goal.enabled ? "" : "is-off"}`}
            >
              <div className="row spread">
                <div>
                  <h3>
                    {goal.label}{" "}
                    {goal.enabled && (
                      <span className={`pill ${done ? "good" : "warn"}`}>
                        {done ? "Unlocked today" : "Locked"}
                      </span>
                    )}
                  </h3>
                  <p className="earn-rule">
                    <strong>{goal.minutes} min</strong> on{" "}
                    <strong>{websiteNames(goal.goalDomains).join(", ")}</strong> unlocks{" "}
                    {listNames(locked)}
                  </p>
                </div>
                <Switch
                  label={`Enable ${goal.label}`}
                  checked={goal.enabled}
                  disabled={busy}
                  onChange={() => void save({ ...goal, enabled: !goal.enabled })}
                />
              </div>
              {goal.enabled && (
                <>
                  <span
                    className="meter large"
                    role="progressbar"
                    aria-label={`${goal.label} progress today`}
                    aria-valuemin={0}
                    aria-valuemax={goal.minutes}
                    aria-valuenow={earned}
                  >
                    <span style={{ width: `${(earned / goal.minutes) * 100}%` }} />
                  </span>
                  <p className="muted small earn-progress">
                    {done
                      ? `Goal met. ${listNames(locked)} ${locked.length === 1 ? "is" : "are"} open until midnight.`
                      : `${earned} of ${goal.minutes} min today · ${Math.ceil(left / 60_000)} min to go`}
                  </p>
                </>
              )}
              <div className="row window-actions">
                <button className="button secondary" onClick={() => edit(goal)}>
                  Edit goal
                </button>
                <button
                  className="button ghost danger"
                  disabled={busy}
                  onClick={() => void remove(goal)}
                >
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {editing && (
        <div className="modal-backdrop">
          <section
            className="modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="earn-title"
          >
            <form
              className="window-form"
              onSubmit={(e) => {
                e.preventDefault();
                void save(editedGoal(editing));
              }}
            >
              <div className="modal-head">
                <h2 id="earn-title">
                  {goals.some((g) => g.id === editing.id) ? "Edit goal" : "New goal"}
                </h2>
                <button
                  type="button"
                  className="modal-close"
                  aria-label="Close"
                  title="Close (Esc)"
                  onClick={() => setEditing(undefined)}
                >
                  ×
                </button>
              </div>
              <div className="form-grid earn-grid">
                <div className="field">
                  <label htmlFor="earn-site">Earn time on</label>
                  <input
                    id="earn-site"
                    placeholder="duolingo.com"
                    required
                    autoFocus
                    value={goalSite}
                    onChange={(e) => setGoalSite(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="earn-minutes">Minutes each day</label>
                  <input
                    id="earn-minutes"
                    type="number"
                    min={1}
                    max={1440}
                    required
                    value={editing.minutes || ""}
                    onChange={(e) =>
                      setEditing({ ...editing, minutes: Number(e.target.value) })
                    }
                  />
                </div>
              </div>
              {goalBlocked && (
                <p className="window-conflict" role="alert">
                  {goalDomain} is blocked right now by your other settings, so time there
                  can’t count until it opens.
                </p>
              )}
              <div className="field">
                <label htmlFor="earn-name">Goal name</label>
                <input
                  id="earn-name"
                  placeholder={goalDomain ? `Earn it on ${goalDomain}` : "Language practice"}
                  maxLength={60}
                  value={editing.label}
                  onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                />
              </div>
              <fieldset className="group">
                <legend>Until then, block</legend>
                <div className="whitelist">
                  {launchSites.map((s) => {
                    const selected = editing.lockedDomains.some((d) =>
                      hostMatchesDomain(s.domain, d),
                    );
                    const aliases = expandDomainAliases([s.domain]);
                    return (
                      <label className="check" key={s.id}>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() =>
                            setEditing({
                              ...editing,
                              lockedDomains: selected
                                ? editing.lockedDomains.filter((d) => !aliases.includes(d))
                                : [...editing.lockedDomains, ...aliases],
                            })
                          }
                        />
                        {s.name}
                      </label>
                    );
                  })}
                </div>
                <label className="field">
                  Other websites
                  <input
                    placeholder="example.com, another.com"
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                  />
                </label>
              </fieldset>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="focus-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setEditing(undefined)}
                >
                  Cancel
                </button>
                <button className="button" disabled={busy}>
                  {busy ? "Saving…" : "Save goal"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}

function ShareSettings({
  state,
  onState,
  onNotice,
}: {
  state: AppState;
  onState: (s: AppState) => void;
  onNotice: (n: Notice) => void;
}) {
  const [myCode, setMyCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState("");
  const [preview, setPreview] = useState<SharedSummary>();
  const [pasteError, setPasteError] = useState("");
  const [busy, setBusy] = useState(false);

  async function copyMine() {
    const code = await encodeShareCode(exportSettings(state, Date.now()));
    setMyCode(code);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }
  useEffect(() => {
    setPreview(undefined);
    setPasteError("");
    if (!pasted.trim()) return;
    let current = true;
    decodeShareCode(pasted)
      .then((data) => current && setPreview(summarizeShared(data)))
      .catch((e: Error) => current && setPasteError(e.message));
    return () => {
      current = false;
    };
  }, [pasted]);

  async function apply() {
    if (!(await passwordGate(state))) return;
    const yes = await confirmDialog({
      question: "Use these settings?",
      detail:
        "Your websites, windows, earn goals and feed blocking will be replaced with the ones in this code. Today’s usage and your password stay as they are.",
      yes: "Replace my settings",
      no: "Cancel",
    });
    if (!yes) return;
    setBusy(true);
    const r = await send<AppState>({ type: "IMPORT_SHARE_CODE", code: pasted });
    setBusy(false);
    if (!r.ok) return onNotice({ kind: "error", text: r.error });
    onState(r.data);
    setPasted("");
    onNotice({ kind: "success", text: "Shared settings applied." });
  }

  return (
    <section className="card settings-block share">
      <h2>Share your setup</h2>
      <p className="muted">
        Copy a code with your website settings and send it to a friend, or paste theirs to
        use the same setup. A code holds your limits, blocks, windows, earn goals and feed
        blocking. It never includes your usage, history or password.
      </p>
      <div className="share-step">
        <h3>Your code</h3>
        <button className="button" onClick={() => void copyMine()}>
          {copied ? "Copied!" : myCode ? "Copy again" : "Copy my share code"}
        </button>
        {myCode && (
          <textarea
            className="share-code"
            readOnly
            aria-label="Your share code"
            value={myCode}
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
      </div>
      <div className="share-step">
        <h3>Use someone’s code</h3>
        <textarea
          className="share-code"
          aria-label="Paste a share code"
          placeholder="Paste a code that starts with SCREENFRY-1-"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
        />
        {pasteError && (
          <p className="error" role="alert">
            {pasteError}
          </p>
        )}
        {preview && (
          <div className="share-preview">
            <strong>This code sets:</strong>
            <ul>
              <li>
                {preview.blocked.length
                  ? `Blocked: ${listNames(preview.blocked)}`
                  : "No fully blocked websites"}
              </li>
              <li>
                {preview.limits.length
                  ? `Daily limits: ${preview.limits.join(", ")}`
                  : "No daily limits"}
              </li>
              <li>
                {preview.windows.length
                  ? `Windows: ${listNames(preview.windows)}`
                  : "No windows"}
              </li>
              {preview.earnGoals.length > 0 && (
                <li>Earn goals: {preview.earnGoals.join("; ")}</li>
              )}
              <li>
                {preview.feedBlockingOn
                  ? `${preview.feedBlockers} feed and button blocker${preview.feedBlockers === 1 ? "" : "s"} on`
                  : "Feed and button blocking off"}
              </li>
            </ul>
            <button className="button" disabled={busy} onClick={() => void apply()}>
              {busy ? "Applying…" : "Use these settings"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
