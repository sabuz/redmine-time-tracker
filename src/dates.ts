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

/**
 * The days new time can be added to: from the first of the current month to the end of the
 * current week. Earlier months are closed, and so are the weeks still to come.
 */
export function loggableRange(today: string, weekStart: WeekStart): { from: string; to: string } {
  const t = parseIso(today);
  return {
    from: iso(new Date(t.getFullYear(), t.getMonth(), 1)),
    to: iso(addDays(startOfWeek(t, weekStart), 6)),
  };
}

export function canLogOn(date: string, today: string, weekStart: WeekStart): boolean {
  const { from, to } = loggableRange(today, weekStart);
  return date >= from && date <= to;
}

const fmt = (opts: Intl.DateTimeFormatOptions) => (d: Date) => d.toLocaleDateString(undefined, opts);

export const weekdayShort = fmt({ weekday: "short" });
export const dayLong = fmt({ weekday: "long", day: "numeric", month: "long" });
export const monthDay = fmt({ month: "short", day: "numeric" });

/** Entries can be edited or deleted from the first of the current month on; earlier months are read-only. */
export const canChangeOn = (date: string, today: string): boolean => date >= `${today.slice(0, 7)}-01`;
