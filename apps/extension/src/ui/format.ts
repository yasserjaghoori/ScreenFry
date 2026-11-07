export function formatDuration(ms: number): string {
  if (ms < 60_000) return ms > 0 ? '<1m' : '0m';
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function formatMinutes(minutes: number): string {
  if (minutes === 0) return 'No access';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? (rest ? `${hours}h ${rest}m` : `${hours}h`) : `${rest}m`;
}

export function formatCountdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const time = (date: Date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** "today at 5:00 PM", "tomorrow at 12:00 AM", "Friday at 9:00 AM", or a full date further out. */
export function formatWhen(ms: number | undefined, now = Date.now()): string {
  if (ms === undefined) return 'more than a week from now';
  const date = new Date(ms);
  const today = new Date(now);
  const dayDiff = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
  if (dayDiff === 0) return `today at ${time(date)}`;
  if (dayDiff === 1) return `tomorrow at ${time(date)}`;
  if (dayDiff > 1 && dayDiff < 7) return `${date.toLocaleDateString([], { weekday: 'long' })} at ${time(date)}`;
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export const formatDate = (ms?: number) => (ms ? new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export const toTimeInput = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export const fromTimeInput = (value: string) => { const [h, m] = value.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export function formatMinuteOfDay(minute: number): string {
  return new Date(2000, 0, 1, Math.floor(minute / 60), minute % 60).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
export function describeDays(days: number[]): string {
  const sorted = [...days].sort();
  if (sorted.length === 7) return 'Every day';
  if (sorted.join() === '1,2,3,4,5') return 'Weekdays';
  if (sorted.join() === '0,6') return 'Weekends';
  return sorted.map((day) => DAY_SHORT[day]).join(', ');
}
