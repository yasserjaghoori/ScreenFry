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
/** Bound optional browser round trips; clear the timer on both success and failure. */
export async function withTimeout<T>(
  operation: Promise<T>,
  milliseconds = 1500,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Browser response timed out")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
