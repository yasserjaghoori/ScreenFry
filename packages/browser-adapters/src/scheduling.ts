/** Batch DOM churn into a bounded macrotask so page input and timers can run. */
export function createBatchedTask(run: () => void, delayMs = 50): () => void {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      run();
    }, delayMs);
  };
}
