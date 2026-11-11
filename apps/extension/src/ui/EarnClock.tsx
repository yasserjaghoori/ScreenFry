import React, { useEffect, useState } from "react";
import { send } from "@browser/messages";
import { earnGoalUsed, earnRemaining } from "@policy/index";
import type { AppState, EarnGoal } from "@shared/index";

const clock = (ms: number) => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};

/**
 * Earn goals ticking now: goal id → when their unsaved time started. Asked every second, so
 * a goal website in front (in another window, say) counts up live here. While ScreenFry's
 * popup is open, goals pause, so nothing ticks there.
 */
export function useEarnLive(): Record<string, number> {
  const [live, setLive] = useState<Record<string, number>>({});
  useEffect(() => {
    let on = true;
    const ask = () =>
      void send<Record<string, number>>({ type: "EARN_LIVE" }).then((r) => {
        if (on && r.ok) setLive((old) => (JSON.stringify(old) === JSON.stringify(r.data) ? old : r.data));
      });
    ask();
    const timer = setInterval(ask, 1000);
    return () => {
      on = false;
      clearInterval(timer);
    };
  }, []);
  return live;
}

/** Time toward a goal's next completion, by the second: "12:34 of 30:00". */
export function earnClock(state: AppState, goal: EarnGoal, live: Record<string, number>, now = Date.now()) {
  const step = goal.minutes * 60_000;
  const done = earnRemaining(state, goal, now) === 0;
  const running = !done && live[goal.id] !== undefined;
  const extra = running ? Math.max(0, now - live[goal.id]) : 0;
  const toward = done ? step : Math.min(step, (earnGoalUsed(state, goal, now) % step) + extra);
  return { toward, step, running, done, text: `${clock(toward)} of ${clock(step)}` };
}

/** A goal's live clock with a bar, for the Earn page and the popup. */
export function EarnClock({
  state,
  goal,
  live,
  pausedNote = "Paused",
}: {
  state: AppState;
  goal: EarnGoal;
  live: Record<string, number>;
  pausedNote?: string;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const c = earnClock(state, goal, live);
  return (
    <div className="earn-clock">
      <span
        className="meter large"
        role="progressbar"
        aria-label={`${goal.label} progress`}
        aria-valuemin={0}
        aria-valuemax={c.step / 1000}
        aria-valuenow={Math.floor(c.toward / 1000)}
      >
        <span style={{ width: `${(c.toward / c.step) * 100}%` }} />
      </span>
      <span className="earn-clock-time">
        <strong>{c.text}</strong>{" "}
        <span className="muted small">
          {c.done ? "Done for today" : c.running ? "Counting" : pausedNote}
          {goal.strict && !c.done ? " · strict: leaving starts it over" : ""}
        </span>
      </span>
    </div>
  );
}
