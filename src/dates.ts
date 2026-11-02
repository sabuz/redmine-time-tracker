// Dates are passed around as local "YYYY-MM-DD" strings (what Redmine's
// spent_on uses) and only turned into Date objects for arithmetic, so time
// zones can never shift an entry onto a different day.

export type WeekStart = 0 | 1; // 0 = Sunday, 1 = Monday

const pad = (n: number) => String(n).padStart(2, "0");

export const iso = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parseIso = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const startOfWeek = (d: Date, weekStart: WeekStart): Date => addDays(d, -((d.getDay() - weekStart + 7) % 7));

export const weekDays = (start: Date): Date[] => Array.from({ length: 7 }, (_, i) => addDays(start, i));

const fmt = (opts: Intl.DateTimeFormatOptions) => (d: Date) => d.toLocaleDateString(undefined, opts);

export const weekdayShort = fmt({ weekday: "short" });
export const dayLong = fmt({ weekday: "long", day: "numeric", month: "long" });
const monthDay = fmt({ month: "short", day: "numeric" });

/** "Nov 1 – 7, 2026" or "Oct 26 – Nov 1, 2026". */
export function weekRange(start: Date): string {
  const end = addDays(start, 6);
  const endPart = start.getMonth() === end.getMonth() ? String(end.getDate()) : monthDay(end);
  return `${monthDay(start)} – ${endPart}, ${end.getFullYear()}`;
}
