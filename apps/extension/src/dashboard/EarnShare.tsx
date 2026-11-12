import React, { useEffect, useState } from "react";
import { send } from "@browser/messages";
import { launchSites } from "@core/sites";
import { expandDomainAliases, hostMatchesDomain, normalizeDomain } from "@core/domains";
import { checkSettings, loadoutSettings } from "@core/actions";
import { createDefaultState } from "@core/defaults";
import {
  decodeShareCode,
  encodeShareCode,
  summarizeShared,
  websiteNames,
  type SharedSummary,
} from "@core/share";
import {
  earnCompletions,
  earnRemaining,
  earnedFryRemaining,
  evaluatePolicy,
  fryKeyForDomain,
  isFryGoal,
} from "@policy/index";
import { LOADOUT_COUNT, type AppState, type EarnGoal } from "@shared/index";
import { Switch } from "../ui/SiteControls";
import { EarnClock, useEarnLive } from "../ui/EarnClock";
import { confirmLoosen } from "../ui/ConfirmLoosen";
import { confirmDialog } from "../ui/ConfirmDialog";
import { passwordGate } from "../ui/PasswordPrompt";
import { shareSlides, type ShareSlide } from "../ui/share-changes";
import type { Notice } from "./index";

/** The Earn page: earn goals, beside Websites and Windows. */
export function Earn({
  state,
  onState,
  onNotice,
}: {
  state: AppState;
  onState: (s: AppState) => void;
  onNotice: (n: Notice) => void;
}) {
  return (
    <div className="settings-content">
      <EarnTime state={state} onState={onState} onNotice={onNotice} />
    </div>
  );
}

/**
 * The Share page: loadouts and share codes. They change settings only through background
 * messages (core actions and the optional password).
 */
export function Share({
  state,
  onState,
  onNotice,
}: {
  state: AppState;
  onState: (s: AppState) => void;
  onNotice: (n: Notice) => void;
}) {
  return (
    <div className="settings-content">
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
const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;
/** How many amounts a "different each time" reward lists: one per payout, 3 with no limit. */
const scheduleLength = (repeats: number | undefined) => (repeats === 0 ? 3 : Math.max(2, repeats ?? 1));
/** "10 min", or "1, 5 then 10 min" when it differs each time. */
function describeFryReward(goal: EarnGoal): string {
  const schedule = goal.fryMinutesSchedule;
  if (schedule?.length)
    return `${schedule.slice(0, -1).join(", ")} then ${schedule[schedule.length - 1]} min`;
  return `${goal.fryMinutes ?? 0} min`;
}
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
  const live = useEarnLive();
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
    if (before.strict && !after.strict) return true; // turning strict mode off
    const kept = expandDomainAliases(after.lockedDomains.map(normalizeDomain));
    if (!isFryGoal(before))
      return isFryGoal(after) || before.lockedDomains.some((d) => !kept.includes(d));
    // A Fry Time goal loosens when it pays out more: more often or more minutes.
    const times = (g: EarnGoal) => (g.repeats === 0 ? Infinity : (g.repeats ?? 1));
    const most = (g: EarnGoal) =>
      Math.max(g.fryMinutes ?? 0, ...(g.fryMinutesSchedule ?? []));
    if (!isFryGoal(after)) return false; // back to unlocking: stricter
    const added = after.lockedDomains.some((d) => !before.lockedDomains.includes(d));
    return times(after) > times(before) || most(after) > most(before) || added;
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
        Pick a website that’s good for you and how long to spend there. Meeting the goal
        either unlocks websites you choose (blocked until then, locked again at midnight) or
        earns Fry Time on them, once a day or as many times as you like.
      </p>
      <p className="muted small">
        Only active time on the goal website counts: its tab in front while you’re using
        the computer. Background tabs and idle time don’t.
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
          const fry = isFryGoal(goal);
          const completions = earnCompletions(state, goal, now);
          const locked = websiteNames(goal.lockedDomains);
          const done = left === 0;
          // One pool shared by all the goal's websites.
          const fryLeft = fry ? earnedFryRemaining(state, goal, now) : 0;
          return (
            <article
              key={goal.id}
              className={`earn-goal ${done ? "is-earned" : ""} ${goal.enabled ? "" : "is-off"}`}
            >
              <div className="row spread">
                <div>
                  <h3>
                    {goal.label}{" "}
                    {goal.enabled && !fry && (
                      <span className={`pill ${done ? "good" : "warn"}`}>
                        {done ? "Unlocked today" : "Locked"}
                      </span>
                    )}
                    {goal.enabled && fry && fryLeft > 0 && (
                      <span className="pill subtle">Fry Time earned</span>
                    )}
                  </h3>
                  <p className="earn-rule">
                    {fry ? "Every " : ""}
                    <strong>{goal.minutes} min</strong> on{" "}
                    <strong>{websiteNames(goal.goalDomains).join(", ")}</strong>{" "}
                    {fry ? (
                      <>
                        earns <strong>{describeFryReward(goal)}</strong> of Fry Time on{" "}
                        {listNames(locked)}
                        {goal.repeats === 0
                          ? ", as often as you like"
                          : (goal.repeats ?? 1) > 1
                            ? `, up to ${goal.repeats} times a day`
                            : ", once a day"}
                      </>
                    ) : (
                      <>unlocks {listNames(locked)}</>
                    )}
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
                  <EarnClock state={state} goal={goal} live={live} pausedNote="Paused: it counts while the goal website is in front" />
                  <p className="muted small earn-progress">
                    {fry
                      ? `${completions === 0 ? "Not earned yet today" : `Earned ${completions}× today`}${fryLeft > 0 ? ` · ${Math.ceil(fryLeft / 60_000)} min of Fry Time left` : ""}${done ? " · that’s all for today" : ""}`
                      : done
                        ? `Goal met. ${listNames(locked)} ${locked.length === 1 ? "is" : "are"} open until midnight.`
                        : "Locked until the goal is met"}
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
                  <label htmlFor="earn-minutes">Minutes each time</label>
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
                <legend>When the goal is met</legend>
                <div className="segmented" role="radiogroup">
                  {(
                    [
                      ["unlock", "Unlock websites", "Until then, they’re blocked"],
                      ["fry", "Earn Fry Time", "No filter on websites for a while"],
                    ] as const
                  ).map(([reward, title, hint]) => (
                    <button
                      type="button"
                      key={reward}
                      role="radio"
                      aria-checked={(editing.reward ?? "unlock") === reward}
                      className={(editing.reward ?? "unlock") === reward ? "selected" : ""}
                      onClick={() =>
                        setEditing(
                          reward === "fry"
                            ? { ...editing, reward, repeats: editing.repeats ?? 1, fryMinutes: editing.fryMinutes ?? 10 }
                            : { ...editing, reward: undefined },
                        )
                      }
                    >
                      <strong>{title}</strong>
                      <span>{hint}</span>
                    </button>
                  ))}
                </div>
                {isFryGoal(editing) && (
                  <div className="earn-fry">
                    <label className="field">
                      Times a day it can be earned
                      <select
                        value={editing.repeats ?? 1}
                        onChange={(e) => {
                          const repeats = Number(e.target.value);
                          const schedule = editing.fryMinutesSchedule;
                          setEditing({
                            ...editing,
                            repeats,
                            // Once a day leaves nothing to vary; otherwise one amount per time.
                            fryMinutesSchedule:
                              !schedule || repeats === 1 || repeats === 0
                                ? undefined
                                : Array.from(
                                    { length: scheduleLength(repeats) },
                                    (_, i) => schedule[Math.min(i, schedule.length - 1)],
                                  ),
                          });
                        }}
                      >
                        {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                          <option key={n} value={n}>
                            {n === 1 ? "Once" : `${n} times`}
                          </option>
                        ))}
                        <option value={0}>No limit</option>
                      </select>
                    </label>
                    <div className="segmented" role="radiogroup">
                      {(
                        [
                          ["same", "Same every time", "e.g. 5 min each time"],
                          // Different each time needs a last time, so not with no limit.
                          ...(editing.repeats === 1 || editing.repeats === 0
                            ? []
                            : ([["schedule", "Different each time", "e.g. 1, then 5, then 10 min"]] as const)),
                        ] as const
                      ).map(([kind, title, hint]) => {
                        const current = editing.fryMinutesSchedule ? "schedule" : "same";
                        const first = editing.fryMinutesSchedule?.[0] ?? editing.fryMinutes ?? 10;
                        return (
                          <button
                            type="button"
                            key={kind}
                            role="radio"
                            aria-checked={current === kind}
                            className={current === kind ? "selected" : ""}
                            onClick={() =>
                              setEditing(
                                kind === "schedule"
                                  ? {
                                      ...editing,
                                      fryMinutes: first,
                                      fryMinutesSchedule:
                                        editing.fryMinutesSchedule ??
                                        Array.from({ length: scheduleLength(editing.repeats) }, () => first),
                                    }
                                  : { ...editing, fryMinutes: first, fryMinutesSchedule: undefined },
                              )
                            }
                          >
                            <strong>{title}</strong>
                            <span>{hint}</span>
                          </button>
                        );
                      })}
                    </div>
                    {!editing.fryMinutesSchedule && (
                      <label className="field">
                        Fry Time earned each time (minutes)
                        <input
                          type="number"
                          min={1}
                          max={1440}
                          required
                          value={editing.fryMinutes ?? ""}
                          onChange={(e) =>
                            setEditing({
                              ...editing,
                              fryMinutes: e.target.value === "" ? undefined : Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    )}
                    {editing.fryMinutesSchedule && (
                      <div className="fry-schedule">
                        {editing.fryMinutesSchedule.map((m, i) => (
                          <label className="field" key={i}>
                            {ordinal(i + 1)} time
                            {editing.repeats === 0 && i === editing.fryMinutesSchedule!.length - 1 ? " and after" : ""}{" "}
                            (min)
                            <input
                              type="number"
                              min={1}
                              max={1440}
                              required
                              value={Number.isNaN(m) ? "" : m}
                              onChange={(e) => {
                                const next = [...editing.fryMinutesSchedule!];
                                next[i] = e.target.value === "" ? NaN : Number(e.target.value);
                                setEditing({ ...editing, fryMinutes: next[0], fryMinutesSchedule: next });
                              }}
                            />
                          </label>
                        ))}
                      </div>
                    )}
                    <p className="muted small">
                      Earned Fry Time is one pool shared by these websites (2 minutes on X and 3
                      on YouTube use 5), and each time you earn more it adds to what’s left. It
                      works outside Fry Time windows too and never uses up a window’s minutes
                      (during a window, the window’s go first). Each time you meet the goal, feed blocking pauses on these websites for
                      the minutes you choose, whenever you use them that day.
                    </p>
                  </div>
                )}
              </fieldset>
              <div className="control-row noted earn-strict">
                <span>
                  Strict mode
                  <small className="control-row-note">
                    Only unbroken time counts. Leaving the goal website (another tab or app,
                    going idle, or opening ScreenFry) starts the time toward the goal over.
                  </small>
                </span>
                <Switch
                  label="Strict mode"
                  checked={editing.strict === true}
                  onChange={() => setEditing({ ...editing, strict: !editing.strict })}
                />
              </div>
              <fieldset className="group">
                <legend>{isFryGoal(editing) ? "Websites that earn Fry Time" : "Until then, block"}</legend>
                <div className="whitelist">
                  {launchSites.map((s) => {
                    const selected = editing.lockedDomains.some((d) =>
                      hostMatchesDomain(s.domain, d),
                    );
                    const aliases = expandDomainAliases([s.domain]);
                    return (
                      <div className="check-row" key={s.id}>
                        <label className="check">
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
                      </div>
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

/** What a loadout or code sets, as a short list. */
function SettingsSummary({ summary }: { summary: SharedSummary }) {
  return (
    <ul>
      <li>
        {summary.blocked.length ? `Blocked: ${listNames(summary.blocked)}` : "No fully blocked websites"}
      </li>
      <li>{summary.limits.length ? `Daily limits: ${summary.limits.join(", ")}` : "No daily limits"}</li>
      <li>{summary.windows.length ? `Windows: ${listNames(summary.windows)}` : "No windows"}</li>
      {summary.earnGoals.length > 0 && <li>Earn goals: {summary.earnGoals.join("; ")}</li>}
      <li>
        {summary.feedBlockingOn
          ? `${summary.feedBlockers} feed and button blocker${summary.feedBlockers === 1 ? "" : "s"} on`
          : "Feed and button blocking off"}
      </li>
    </ul>
  );
}

/**
 * Share your setup, with loadouts: five slots for whole setups. The loadout in use is your
 * live settings; switching saves it and applies another. A share code holds one loadout.
 */
function ShareSettings({
  state,
  onState,
  onNotice,
}: {
  state: AppState;
  onState: (s: AppState) => void;
  onNotice: (n: Notice) => void;
}) {
  const active = state.activeLoadout ?? 0;
  const [selected, setSelected] = useState(active);
  const [myCode, setMyCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState("");
  const [slides, setSlides] = useState<ShareSlide[]>();
  const [pasteError, setPasteError] = useState("");
  const [busy, setBusy] = useState(false);
  const settings = loadoutSettings(state, selected, Date.now());
  const nameOf = (i: number) => state.loadoutNames?.[i]?.trim() || `Loadout ${i + 1}`;
  const name = nameOf(selected);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");

  useEffect(() => {
    setMyCode("");
    setCopied(false);
    setPasted("");
    setRenaming(false);
  }, [selected]);
  async function saveName() {
    const r = await send<AppState>({ type: "RENAME_LOADOUT", index: selected, name: draftName });
    if (!r.ok) return onNotice({ kind: "error", text: r.error });
    onState(r.data);
    setRenaming(false);
  }
  // Decode and check the pasted code as it's typed, then lay out what it would change in
  // this loadout (an empty loadout is compared with a fresh install).
  const comparedWith = settings ?? createDefaultState();
  useEffect(() => {
    setSlides(undefined);
    setPasteError("");
    if (!pasted.trim()) return;
    let current = true;
    decodeShareCode(pasted)
      .then((data) => {
        if (!current) return;
        const { settings: incoming, error } = checkSettings(data, Date.now());
        if (!incoming) return setPasteError(error!);
        setSlides(
          shareSlides(comparedWith, {
            ...incoming,
            earnGoals: incoming.earnGoals ?? comparedWith.earnGoals ?? [],
            warningsEnabled: incoming.warningsEnabled ?? comparedWith.warningsEnabled,
          }),
        );
      })
      .catch((e: Error) => current && setPasteError(e.message));
    return () => {
      current = false;
    };
    // Recomputed when the code or the compared loadout's settings change, not on usage ticks.
  }, [pasted, JSON.stringify({ ...comparedWith, savedAt: 0 })]);

  async function copyCode() {
    if (!settings) return;
    const { savedAt: _saved, ...rest } = settings;
    const code = await encodeShareCode(rest);
    setMyCode(code);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }
  async function run(request: Parameters<typeof send>[0], success: string) {
    setBusy(true);
    const r = await send<AppState>(request);
    setBusy(false);
    if (!r.ok) return onNotice({ kind: "error", text: r.error });
    onState(r.data);
    onNotice({ kind: "success", text: success });
  }
  async function useLoadout() {
    if (!(await passwordGate(state))) return;
    const yes = await confirmDialog({
      question: `Switch to ${name}?`,
      detail: `Your websites, windows, earn goals and feed blocking change to ${name}. Your current setup stays saved in Loadout ${active + 1}. Today’s usage and your password stay as they are.`,
      yes: `Use ${name}`,
      no: "Cancel",
    });
    if (yes) await run({ type: "SWITCH_LOADOUT", index: selected }, `Now using ${name}.`);
  }
  async function saveCurrentHere() {
    if (!(await passwordGate(state))) return;
    await run({ type: "COPY_TO_LOADOUT", index: selected }, `Your current setup is saved in ${name}.`);
  }
  async function empty() {
    if (!(await passwordGate(state))) return;
    const yes = await confirmDialog({
      question: `Empty ${name}?`,
      detail: "The setup saved in it is deleted. Copy its share code first if you might want it again.",
      yes: `Empty ${name}`,
      no: "Cancel",
    });
    if (yes) await run({ type: "CLEAR_LOADOUT", index: selected }, `${name} is empty.`);
  }
  async function applyCode() {
    if (!(await passwordGate(state))) return;
    if (settings) {
      const inUse = selected === active;
      const yes = await confirmDialog({
        question: inUse ? "Replace your current setup?" : `Replace ${name}?`,
        detail: inUse
          ? "Your websites, windows, earn goals and feed blocking will be replaced with the ones in this code. Today’s usage and your password stay as they are."
          : `The setup saved in ${name} will be replaced with this code.`,
        yes: "Replace",
        no: "Cancel",
      });
      if (!yes) return;
    }
    await run({ type: "SET_LOADOUT_FROM_CODE", index: selected, code: pasted }, `${name} now has the shared setup.`);
    setPasted("");
  }

  return (
    <section className="card settings-block share">
      <h2>Share your setup</h2>
      <p className="muted">
        Keep up to five setups as loadouts and switch between them. A share code holds one
        loadout (its limits, blocks, windows, earn goals and feed blocking), never your usage,
        history or password. Send it to a friend, or paste theirs into a loadout.
      </p>
      <div className="loadout-tabs" role="tablist" aria-label="Loadouts">
        {Array.from({ length: LOADOUT_COUNT }, (_, i) => {
          const filled = i === active || Boolean(state.loadouts?.[i]);
          return (
            <button
              key={i}
              role="tab"
              aria-selected={selected === i}
              className={`loadout-tab ${selected === i ? "selected" : ""} ${filled ? "" : "empty"}`}
              onClick={() => setSelected(i)}
            >
              <strong>{nameOf(i)}</strong>
              <span>{i === active ? "In use" : filled ? "Saved" : "Empty"}</span>
            </button>
          );
        })}
      </div>
      <div className="loadout-panel" role="tabpanel" aria-label={name}>
        {renaming ? (
          <form
            className="row loadout-rename"
            onSubmit={(e) => {
              e.preventDefault();
              void saveName();
            }}
          >
            <input
              aria-label="Loadout name"
              maxLength={30}
              autoFocus
              placeholder={`Loadout ${selected + 1}`}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
            />
            <button className="button">Save name</button>
            <button type="button" className="button secondary" onClick={() => setRenaming(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="button ghost loadout-rename-button"
            onClick={() => {
              setDraftName(state.loadoutNames?.[selected] ?? "");
              setRenaming(true);
            }}
          >
            Rename {name}
          </button>
        )}
        {settings ? (
          <>
            <div className="share-preview">
              <strong>
                {selected === active ? `${name} is in use. Changes you make are saved to it.` : `${name} sets:`}
              </strong>
              <SettingsSummary summary={summarizeShared(settings)} />
            </div>
            <div className="row wrap loadout-actions">
              {selected !== active && (
                <button className="button" disabled={busy} onClick={() => void useLoadout()}>
                  Use this loadout
                </button>
              )}
              <button
                className={`button ${selected === active ? "" : "secondary"}`}
                onClick={() => void copyCode()}
              >
                {copied ? "Copied!" : myCode ? "Copy again" : "Copy share code"}
              </button>
              {selected !== active && (
                <button className="button ghost danger" disabled={busy} onClick={() => void empty()}>
                  Empty this loadout
                </button>
              )}
            </div>
            {myCode && (
              <textarea
                className="share-code"
                readOnly
                aria-label={`${name} share code`}
                value={myCode}
                onFocus={(e) => e.currentTarget.select()}
              />
            )}
          </>
        ) : (
          <div className="share-preview">
            <strong>{name} is empty.</strong>
            <p className="muted small">Paste a code below, or save your current setup here.</p>
            <button className="button secondary" disabled={busy} onClick={() => void saveCurrentHere()}>
              Save my current setup here
            </button>
          </div>
        )}
        <div className="share-step">
          <h3>{settings ? `Replace ${selected === active ? "it" : name} with a code` : `Put a code in ${name}`}</h3>
          <textarea
            className="share-code"
            aria-label={`Paste a share code into ${name}`}
            placeholder="Paste a code that starts with SF2-"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          {pasteError && (
            <p className="error" role="alert">
              {pasteError}
            </p>
          )}
          {slides && slides.length === 0 && (
            <p className="share-same">This code matches {selected === active ? "your current setup" : name}. Nothing would change.</p>
          )}
          {slides && slides.length > 0 && (
            // Keyed by content, so a re-render doesn't jump back to the first slide.
            <ShareSlides
              key={JSON.stringify(slides)}
              slides={slides}
              busy={busy}
              applyLabel={
                !settings
                  ? `Put it in ${name}`
                  : selected === active
                    ? "Replace my current setup"
                    : `Replace ${name}`
              }
              onApply={() => void applyCode()}
            />
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * A slideshow of what a share code changes: one slide per website, each setting shown as
 * now → after. The apply button sits on the last slide; "Accept all" applies without paging.
 */
function ShareSlides({
  slides,
  busy,
  applyLabel,
  onApply,
}: {
  slides: ShareSlide[];
  busy: boolean;
  applyLabel: string;
  onApply: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const at = Math.min(index, slides.length - 1);
  const slide = slides[at];
  const last = at === slides.length - 1;
  const websites = slides.filter((s) => s.key !== "everywhere").length;
  const total = slides.reduce((n, s) => n + s.changes.length, 0);
  const go = (to: number) => {
    if (to < 0 || to >= slides.length || to === at) return;
    setDirection(to > at ? 1 : -1);
    setIndex(to);
  };
  return (
    <div
      className="share-slides"
      role="group"
      aria-roledescription="slideshow"
      aria-label="What this code changes"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(at + 1);
        if (e.key === "ArrowLeft") go(at - 1);
      }}
    >
      <div className="share-slides-head">
        <p>
          This code makes <strong>{total} change{total === 1 ? "" : "s"}</strong>
          {websites ? ` across ${websites} website${websites === 1 ? "" : "s"}` : ""}.
        </p>
        {!last && (
          <button type="button" className="button accent-outline" disabled={busy} onClick={onApply}>
            {busy ? "Saving…" : `Accept all ${total} changes`}
          </button>
        )}
      </div>
      <article
        key={`${slide.key}-${at}`}
        className={`share-slide ${direction > 0 ? "from-right" : "from-left"}`}
        aria-roledescription="slide"
        aria-label={`${at + 1} of ${slides.length}: ${slide.name}`}
      >
        <header>
          <span
            className="site-avatar small-avatar"
            style={{ background: slide.color ?? "var(--muted)" }}
            aria-hidden="true"
          >
            {slide.symbol ?? (slide.key === "everywhere" ? "✦" : slide.name[0].toUpperCase())}
          </span>
          <div>
            <h4>{slide.name}</h4>
            <span className="muted small">
              {slide.changes.length} change{slide.changes.length === 1 ? "" : "s"}
            </span>
          </div>
          <span className="share-slide-count">
            {at + 1} / {slides.length}
          </span>
        </header>
        <ul className="share-changes">
          {slide.changes.map((c) => (
            <li key={c.label}>
              <span className="share-change-label">{c.label}</span>
              <span className="share-change-values">
                <span className="share-from">{c.from}</span>
                <span className="share-arrow" aria-label="becomes">
                  →
                </span>
                <span className="share-to">{c.to}</span>
              </span>
            </li>
          ))}
        </ul>
      </article>
      <div className="share-nav">
        <button
          type="button"
          className="button secondary"
          disabled={at === 0}
          onClick={() => go(at - 1)}
        >
          ‹ Back
        </button>
        <div className="share-dots" role="tablist" aria-label="Slides">
          {slides.map((s, i) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={i === at}
              aria-label={s.name}
              title={s.name}
              className={i === at ? "active" : ""}
              onClick={() => go(i)}
            />
          ))}
        </div>
        {last ? (
          <button type="button" className="button" disabled={busy} onClick={onApply}>
            {busy ? "Saving…" : applyLabel}
          </button>
        ) : (
          <button type="button" className="button" onClick={() => go(at + 1)}>
            Next ›
          </button>
        )}
      </div>
    </div>
  );
}
