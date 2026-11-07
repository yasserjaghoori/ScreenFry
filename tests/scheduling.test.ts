import { afterEach, describe, expect, it, vi } from "vitest";
import { createBatchedTask } from "@browser/scheduling";

afterEach(() => vi.useRealTimers());

describe("content update scheduling", () => {
  it("coalesces a mutation burst and yields before running expensive work", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const schedule = createBatchedTask(run);
    for (let i = 0; i < 1000; i++) schedule();
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(49);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a self-triggered update yields again rather than starving page tasks", () => {
    vi.useFakeTimers();
    let schedule: () => void;
    const run = vi.fn(() => {
      if (run.mock.calls.length < 3) schedule();
    });
    schedule = createBatchedTask(run);
    schedule();
    vi.advanceTimersByTime(50);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(50);
    expect(run).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(50);
    expect(run).toHaveBeenCalledTimes(3);
  });
});
