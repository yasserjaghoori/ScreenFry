export const MINUTE = 60_000;
export const DAY_MS = 86_400_000;

export function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local-calendar midnight, so DST days (23h/25h) and time-zone changes are respected. */
export function nextLocalMidnight(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

export function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function endOfLocalDay(date: Date): number {
  return nextLocalMidnight(date) - 1;
}

export function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Floor to the start of the current wall-clock minute. */
export function floorToMinute(ms: number): number {
  const date = new Date(ms);
  date.setSeconds(0, 0);
  return date.getTime();
}
