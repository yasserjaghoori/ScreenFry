import React, { useEffect, useRef, useState } from "react";
import { send } from "@browser/messages";
import { launchSites } from "@core/sites";
import {
  expandDomainAliases,
  hostMatchesDomain,
  normalizeDomain,
} from "@core/domains";
import {
  ALL_DAYS,
  type AccessWindow,
  type AppState,
  type DayOfWeek,
} from "@shared/index";
import {
  describeDays,
  formatMinuteOfDay,
} from "../ui/format";
import { Switch } from "../ui/SiteControls";
import { confirmLoosen } from "../ui/ConfirmLoosen";
import { confirmDialog } from "../ui/ConfirmDialog";
import { TimePicker } from "../ui/TimePicker";
import { passwordGate } from "../ui/PasswordPrompt";
import {
  describeConflict,
  fryKeyForDomain,
  suspendedWindowIds,
  windowConflicts,
} from "@policy/index";
import type { Notice } from "./index";
const days: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 0];
const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const modeNames = {
  allow: "Allow window",
  block: "Block window",
  free: "Fry Time",
} as const;
const modeTones = { allow: "good", block: "warn", free: "subtle" } as const;
export function Windows({
  state,
  onState,
  onNotice,
}: {
  state: AppState;
  onState: (s: AppState) => void;
  onNotice: (n: Notice) => void;
}) {
  const [editing, setEditing] = useState<AccessWindow>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [custom, setCustom] = useState("");
  /** The window and Other websites text as they were when the editor opened. */
  const original = useRef<{ window: string; custom: string }>(undefined);
  const supportedDomains = expandDomainAliases(
    launchSites.map((s) => s.domain),
  );
  function edit(w: AccessWindow) {
    const typed = w.domains.filter((d) => !supportedDomains.includes(d)).join(", ");
    original.current = { window: JSON.stringify(w), custom: typed };
    setEditing(structuredClone(w));
    setError("");
    setCustom(typed);
  }
  /** Close the editor, asking first when it has unsaved changes. */
  const closing = useRef(false);
  async function requestClose() {
    if (!editing || closing.current) return;
    const changed =
      JSON.stringify(editing) !== original.current?.window ||
      custom !== original.current?.custom;
    if (changed) {
      closing.current = true;
      const discard = await confirmDialog({
        question: "Close without saving?",
        detail: "Your changes to this window will be lost.",
        yes: "Close without saving",
        no: "Keep editing",
      });
      closing.current = false;
      if (!discard) return;
    }
    setEditing(undefined);
  }
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  const editorOpen = Boolean(editing);
  useEffect(() => {
    if (!editorOpen) return;
    const key = (e: KeyboardEvent) => {
      // Escape belongs to a password or confirm prompt open on top of the editor, if any.
      const prompt = document.querySelector('[aria-modal="true"]:not(.modal)');
      if (e.key === "Escape" && !prompt) void requestCloseRef.current();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [editorOpen]);
  const allSelected = (w: AccessWindow) =>
    launchSites.every((s) =>
      w.domains.some((d) => hostMatchesDomain(s.domain, d)),
    );
  /** The editor's websites: ticked sites plus anything typed under Other websites. */
  const editedDomains = (w: AccessWindow) => [
    ...w.domains.filter((d) => supportedDomains.includes(d)),
    ...custom.split(/[\s,]+/).filter(Boolean),
  ];
  const suspended = suspendedWindowIds(state.windows);
  const fryCustom = Boolean(editing && editing.freeMinutesBySite);
  /** Websites typed under Other websites, as Fry Time keys. */
  const otherDomains = [
    ...new Set(
      custom
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((d) => normalizeDomain(d))
        .filter((d) => d && !supportedDomains.includes(d)),
    ),
  ];
  function setFryMinutes(key: string, value: number | undefined) {
    if (!editing) return;
    const next = { ...editing.freeMinutesBySite };
    if (value === undefined) delete next[key];
    else next[key] = value;
    setEditing({ ...editing, freeMinutesBySite: next });
  }
  const editingConflict =
    editing &&
    windowConflicts(state.windows, {
      ...editing,
      domains: editedDomains(editing),
    })[0];
  async function save(w: AccessWindow) {
    if (!(await passwordGate(state))) return;
    setBusy(true);
    const r = await send<AppState>({ type: "SAVE_WINDOW", window: w });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      onNotice({ kind: "error", text: r.error });
      return;
    }
    onState(r.data);
    setEditing(undefined);
    const clash = windowConflicts(r.data.windows, w)[0];
    onNotice(
      clash
        ? {
            kind: "error",
            text: `Window saved, but it contradicts “${clash.other.label}”, so both are paused. Edit either window so they don’t overlap and both start working again.`,
          }
        : { kind: "success", text: "Window saved." },
    );
  }
  return (
    <>
      <div className="window-intro">
        <p>
          An <strong>allow window</strong> is the only time its websites can be
          used: outside it they are blocked, even with time left. A{" "}
          <strong>block window</strong> blocks its websites while it is on.{" "}
          <strong>Fry Time</strong> means no filter for a limited time: while
          it is on, each website’s feed blocking is paused until that website
          uses up its own minutes (the same for every website, or custom per
          website); then that website is back to its normal settings until the
          window ends. A block window that overlaps
          an allow or Fry Time window on the same website contradicts it, so
          both pause until you change one. Daily limits always still count.
          Websites in no window keep their usual settings.
        </p>
        <button
          className="button"
          onClick={() =>
            edit({
              id: crypto.randomUUID(),
              label: "",
              enabled: true,
              domains: [],
              days: [...ALL_DAYS],
              startMinute: 12 * 60,
              endMinute: 18 * 60,
              mode: "allow",
            })
          }
        >
          + Add window
        </button>
      </div>
      <div className="list">
        {state.windows.length === 0 && (
          <div className="empty large">
            <h3>A time and a place for scrolling.</h3>
            <p>Add your first window and choose which websites belong in it.</p>
          </div>
        )}
        {state.windows.map((w) => (
          <article
            className={`card window-card ${suspended.has(w.id) ? "is-paused" : ""}`}
            key={w.id}
          >
            <div className="row spread">
              <div>
                <h2>
                  {w.label}{" "}
                  <span className={`pill ${modeTones[w.mode ?? "allow"]}`}>
                    {modeNames[w.mode ?? "allow"]}
                  </span>
                  {suspended.has(w.id) && (
                    <span className="pill warn">Paused</span>
                  )}
                </h2>
                <p className="window-time">
                  {w.startMinute === w.endMinute ||
                  (w.startMinute === 0 && w.endMinute === 1440)
                    ? "All day"
                    : `${formatMinuteOfDay(w.startMinute)} – ${formatMinuteOfDay(w.endMinute)}`}
                  {w.startMinute > w.endMinute ? " · next day" : ""}
                </p>
                <p className="muted small">
                  {describeDays(w.days)}
                  {w.mode === "free" ? ` · ${describeFry(w)}` : ""}
                </p>
              </div>
              <Switch
                label={`Enable ${w.label}`}
                checked={w.enabled}
                disabled={busy}
                onChange={async () => {
                  if (!(await passwordGate(state))) return;
                  if (w.enabled && !(await confirmWindowOff(w, "off"))) return;
                  void save({ ...w, enabled: !w.enabled });
                }}
              />
            </div>
            <div className="window-sites">
              {[
                ...launchSites
                  .filter((site) =>
                    w.domains.some((d) => hostMatchesDomain(site.domain, d)),
                  )
                  .map((site) => site.name),
                ...w.domains.filter((d) => !supportedDomains.includes(d)),
              ].map((name) => (
                <span className="pill subtle" key={name}>
                  {name}
                </span>
              ))}
            </div>
            {windowConflicts(state.windows, w).map((conflict) => (
              <p className="window-conflict" role="alert" key={conflict.other.id}>
                {describeConflict(w, conflict)}
              </p>
            ))}
            <div className="row window-actions">
              <button className="button secondary" onClick={() => edit(w)}>
                Edit window
              </button>
              <button
                className="button ghost danger"
                disabled={busy}
                onClick={async () => {
                  if (!(await passwordGate(state))) return;
                  if (w.enabled && !(await confirmWindowOff(w, "delete"))) return;
                  setBusy(true);
                  const r = await send<AppState>({
                    type: "DELETE_WINDOW",
                    windowId: w.id,
                  });
                  setBusy(false);
                  if (r.ok) onState(r.data);
                  else onNotice({ kind: "error", text: r.error });
                }}
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
      {editing && (
        <div className="modal-backdrop">
          <section
            className="modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="window-title"
          >
            <form
              className="window-form"
              onSubmit={(e) => {
                e.preventDefault();
                void save({ ...editing, domains: editedDomains(editing) });
              }}
            >
              <div className="modal-head">
                <h2 id="window-title">
                  {state.windows.some((w) => w.id === editing.id)
                    ? "Edit window"
                    : "New window"}
                </h2>
                <button
                  type="button"
                  className="modal-close"
                  aria-label="Close"
                  title="Close (Esc)"
                  onClick={() => void requestClose()}
                >
                  ×
                </button>
              </div>
              <fieldset className="group">
                <legend>During this window</legend>
                <div className="segmented" role="radiogroup">
                  {(
                    [
                      [
                        "allow",
                        "Allow these websites",
                        "Blocked at all other times",
                      ],
                      [
                        "block",
                        "Block these websites",
                        "Usable at other times",
                      ],
                      [
                        "free",
                        "Fry Time",
                        "No filter during this time, for a limited amount of time",
                      ],
                    ] as const
                  ).map(([mode, title, hint]) => (
                    <button
                      type="button"
                      key={mode}
                      role="radio"
                      aria-checked={(editing.mode ?? "allow") === mode}
                      className={
                        (editing.mode ?? "allow") === mode ? "selected" : ""
                      }
                      onClick={() => setEditing({ ...editing, mode })}
                    >
                      <strong>{title}</strong>
                      <span>{hint}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="field">
                <label htmlFor="window-name">Window name</label>
                <input
                  id="window-name"
                  placeholder="Evening break"
                  required
                  maxLength={60}
                  value={editing.label}
                  onChange={(e) =>
                    setEditing({ ...editing, label: e.target.value })
                  }
                />
              </div>
              <fieldset className="group window-days">
                <legend>Days</legend>
                <div className="day-pills">
                  {days.map((d) => (
                    <button
                      type="button"
                      key={d}
                      aria-label={labels[d]}
                      aria-pressed={editing.days.includes(d)}
                      className={editing.days.includes(d) ? "selected" : ""}
                      onClick={() =>
                        setEditing({
                          ...editing,
                          days: editing.days.includes(d)
                            ? editing.days.filter((day) => day !== d)
                            : [...editing.days, d],
                        })
                      }
                    >
                      {labels[d]}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="window-start">From</label>
                  <TimePicker
                    id="window-start"
                    value={editing.startMinute % 1440}
                    onChange={(startMinute) =>
                      setEditing({ ...editing, startMinute })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="window-end">Until</label>
                  <TimePicker
                    id="window-end"
                    value={editing.endMinute % 1440}
                    onChange={(endMinute) =>
                      setEditing({ ...editing, endMinute })
                    }
                  />
                </div>
              </div>
              <p className="muted small window-time-hint">
                An end before the start crosses midnight. Equal times mean all
                day.
              </p>
              {editing.mode === "free" && (
                <fieldset className="group">
                  <legend>Fry Time for each website</legend>
                  <div className="segmented" role="radiogroup">
                    {(
                      [
                        [false, "Same for every website", "Each website gets these minutes"],
                        [true, "Custom per website", "Set minutes beside each website below"],
                      ] as const
                    ).map(([custom, title, hint]) => (
                      <button
                        type="button"
                        key={title}
                        role="radio"
                        aria-checked={fryCustom === custom}
                        className={fryCustom === custom ? "selected" : ""}
                        onClick={() =>
                          setEditing(
                            custom
                              ? {
                                  ...editing,
                                  freeMinutes: undefined,
                                  freeMinutesBySite: editing.freeMinutesBySite ?? {},
                                }
                              : { ...editing, freeMinutesBySite: undefined },
                          )
                        }
                      >
                        <strong>{title}</strong>
                        <span>{hint}</span>
                      </button>
                    ))}
                  </div>
                  {!fryCustom && (
                    <div className="field fry-same">
                      <label htmlFor="window-free-minutes">
                        Minutes per website, per day
                      </label>
                      <input
                        id="window-free-minutes"
                        type="number"
                        min={1}
                        max={1440}
                        step={1}
                        placeholder="Whole window"
                        value={editing.freeMinutes ?? ""}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            freeMinutes:
                              e.target.value === ""
                                ? undefined
                                : Number(e.target.value),
                          })
                        }
                      />
                    </div>
                  )}
                  <p className="muted small">
                    During this window, each website’s feed blocking is paused
                    until that website uses up its own minutes. Then it’s back to
                    its normal settings for the rest of the window, while other
                    websites keep their Fry Time. Leave a box empty to pause it
                    for the whole window.
                  </p>
                </fieldset>
              )}
              <fieldset className="group">
                <legend>
                  {editing.mode === "block"
                    ? "Websites to block"
                    : editing.mode === "free"
                      ? "Websites with Fry Time"
                      : "Websites to allow"}
                </legend>
                <button
                  type="button"
                  className="button secondary all-sites"
                  aria-pressed={allSelected(editing)}
                  onClick={() => {
                    const every = expandDomainAliases(
                      launchSites.map((s) => s.domain),
                    );
                    setEditing({
                      ...editing,
                      domains: allSelected(editing)
                        ? editing.domains.filter((d) => !every.includes(d))
                        : [
                            ...editing.domains.filter((d) => !every.includes(d)),
                            ...every,
                          ],
                    });
                  }}
                >
                  {allSelected(editing) ? "Clear all websites" : "All websites"}
                </button>
                <div className="whitelist">
                  {launchSites.map((s) => {
                    const selected = editing.domains.some((d) =>
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
                              domains: selected
                                ? editing.domains.filter(
                                    (d) => !aliases.includes(d),
                                  )
                                : [...editing.domains, ...aliases],
                            })
                          }
                        />
                        {s.name}
                      </label>
                      {fryCustom && selected && (
                        <FryMinutes
                          name={s.name}
                          value={editing.freeMinutesBySite?.[s.id]}
                          onChange={(value) => setFryMinutes(s.id, value)}
                        />
                      )}
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
                {fryCustom && otherDomains.length > 0 && (
                  <div className="whitelist">
                    {otherDomains.map((domain) => (
                      <div className="check-row" key={domain}>
                        <span className="check">{domain}</span>
                        <FryMinutes
                          name={domain}
                          value={editing.freeMinutesBySite?.[domain]}
                          onChange={(value) => setFryMinutes(domain, value)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </fieldset>
              {editingConflict ? (
                <p className="window-conflict" role="alert">
                  {describeConflict(
                    { ...editing, label: editing.label.trim() || "This window" },
                    editingConflict,
                  )}
                </p>
              ) : (
                error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )
              )}
              <div className="focus-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => void requestClose()}
                >
                  Cancel
                </button>
                <button className="button" disabled={busy}>
                  {busy ? "Saving…" : "Save window"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
/** Minutes box beside a website in custom Fry Time. Empty means the whole window. */
function FryMinutes({
  name,
  value,
  onChange,
}: {
  name: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <label className="fry-minutes">
      <input
        type="number"
        min={1}
        max={1440}
        step={1}
        placeholder="All"
        aria-label={`${name} Fry Time minutes per day`}
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? undefined : Number(e.target.value))
        }
      />
      min
    </label>
  );
}
/** "10 min per website a day", or each website's own minutes. */
function describeFry(w: AccessWindow): string {
  if (w.freeMinutesBySite) {
    const parts = Object.entries(w.freeMinutesBySite).map(
      ([key, minutes]) =>
        `${launchSites.find((s) => s.id === key)?.name ?? key} ${minutes} min`,
    );
    const unset = [...new Set(w.domains.map(fryKeyForDomain))].some(
      (key) => w.freeMinutesBySite![key] === undefined,
    );
    return parts.length
      ? `Fry Time: ${parts.join(", ")} a day${unset ? " (others: whole window)" : ""}`
      : "feeds open the whole window";
  }
  return w.freeMinutes === undefined
    ? "feeds open the whole window"
    : `${w.freeMinutes} min of Fry Time per website a day`;
}
/** Allow and block windows restrict you, so switching one off or deleting it asks first. */
function confirmWindowOff(w: AccessWindow, action: "off" | "delete") {
  if (w.mode === "free") return Promise.resolve(true);
  return confirmLoosen(
    action === "off" ? `Turn off “${w.label}”?` : `Delete “${w.label}”?`,
    w.mode === "block"
      ? "This window keeps these websites blocked."
      : "This window keeps these websites closed outside its hours.",
  );
}
