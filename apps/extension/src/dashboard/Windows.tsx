import React, { useState } from "react";
import { send } from "@browser/messages";
import { launchSites } from "@core/sites";
import { expandDomainAliases, hostMatchesDomain } from "@core/domains";
import {
  ALL_DAYS,
  type AccessWindow,
  type AppState,
  type DayOfWeek,
} from "@shared/index";
import {
  describeDays,
  formatMinuteOfDay,
  fromTimeInput,
  toTimeInput,
} from "../ui/format";
import { Switch } from "../ui/SiteControls";
import type { Notice } from "./index";
const days: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 0];
const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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
  const supportedDomains = expandDomainAliases(
    launchSites.map((s) => s.domain),
  );
  function edit(w: AccessWindow) {
    setEditing(structuredClone(w));
    setError("");
    setCustom(
      w.domains.filter((d) => !supportedDomains.includes(d)).join(", "),
    );
  }
  async function save(w: AccessWindow) {
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
    onNotice({ kind: "success", text: "Window saved." });
  }
  return (
    <>
      <div className="window-intro">
        <p>
          An <strong>allow window</strong> is the only time its websites can be
          used: outside it they are blocked, even with time left. A{" "}
          <strong>block window</strong> blocks its websites while it is on.
          Block windows win when both apply, and daily limits always still
          count. Websites in no window keep their usual settings.
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
          <article className="card window-card" key={w.id}>
            <div className="row spread">
              <div>
                <h2>
                  {w.label}{" "}
                  <span
                    className={`pill ${w.mode === "block" ? "warn" : "good"}`}
                  >
                    {w.mode === "block" ? "Block window" : "Allow window"}
                  </span>
                </h2>
                <p className="window-time">
                  {w.startMinute === w.endMinute ||
                  (w.startMinute === 0 && w.endMinute === 1440)
                    ? "All day"
                    : `${formatMinuteOfDay(w.startMinute)} – ${formatMinuteOfDay(w.endMinute)}`}
                  {w.startMinute > w.endMinute ? " · next day" : ""}
                </p>
                <p className="muted small">{describeDays(w.days)}</p>
              </div>
              <Switch
                label={`Enable ${w.label}`}
                checked={w.enabled}
                disabled={busy}
                onChange={() => void save({ ...w, enabled: !w.enabled })}
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
            <div className="row window-actions">
              <button className="button secondary" onClick={() => edit(w)}>
                Edit window
              </button>
              <button
                className="button ghost danger"
                disabled={busy}
                onClick={async () => {
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
              onSubmit={(e) => {
                e.preventDefault();
                const domains = [
                  ...editing.domains.filter((d) =>
                    supportedDomains.includes(d),
                  ),
                  ...custom.split(/[\s,]+/).filter(Boolean),
                ];
                void save({ ...editing, domains });
              }}
            >
              <h2 id="window-title">
                {state.windows.some((w) => w.id === editing.id)
                  ? "Edit window"
                  : "New window"}
              </h2>
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
                  <input
                    id="window-start"
                    type="time"
                    required
                    value={toTimeInput(editing.startMinute)}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        startMinute: fromTimeInput(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="window-end">Until</label>
                  <input
                    id="window-end"
                    type="time"
                    required
                    value={toTimeInput(editing.endMinute % 1440)}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        endMinute: fromTimeInput(e.target.value),
                      })
                    }
                  />
                </div>
              </div>
              <p className="muted small">
                An end before the start crosses midnight. Equal times mean all
                day.
              </p>
              <fieldset className="group">
                <legend>
                  {editing.mode === "block"
                    ? "Websites to block"
                    : "Websites to allow"}
                </legend>
                <div className="whitelist">
                  {launchSites.map((s) => {
                    const selected = editing.domains.some((d) =>
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
