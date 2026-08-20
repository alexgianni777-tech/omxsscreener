const DAY_MS = 86_400_000;

/**
 * Yahoo's earnings timestamps include a time of day. For a report calendar we
 * must compare the exchange-provided calendar dates, not round elapsed hours:
 * an after-close report at 20:00 UTC is still today's report, not tomorrow's.
 */
function utcCalendarStart(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function calendarDaysBetween(eventDate: Date, referenceDate = new Date()): number | null {
  const eventMs = eventDate.getTime();
  const referenceMs = referenceDate.getTime();
  if (!Number.isFinite(eventMs) || !Number.isFinite(referenceMs)) return null;
  return (utcCalendarStart(eventDate) - utcCalendarStart(referenceDate)) / DAY_MS;
}

export function calendarDaysUntil(
  value: Date | number | null | undefined,
  referenceDate = new Date(),
): number | null {
  if (value == null) return null;
  const eventDate = value instanceof Date ? value : new Date(value * 1_000);
  return calendarDaysBetween(eventDate, referenceDate);
}

export function utcCalendarDate(value: Date | null | undefined): string | null {
  if (!value || !Number.isFinite(value.getTime())) return null;
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0"),
  ].join("-");
}