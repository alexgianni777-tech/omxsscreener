const STOCKHOLM_DATE = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit",
});

export function stockholmSignalDate(now = new Date()): string {
  return STOCKHOLM_DATE.format(now);
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

/** Previous weekday close; Friday remains the previous trading day on Monday. */
export function previousTradingDate(date: string): string {
  if (!validDate(date)) throw new Error("Invalid reference date");
  const previous = new Date(`${date}T12:00:00Z`);
  do { previous.setUTCDate(previous.getUTCDate() - 1); }
  while (previous.getUTCDay() === 0 || previous.getUTCDay() === 6);
  return previous.toISOString().slice(0, 10);
}

/** Unknown dates, future reports and reports older than one previous close fail closed. */
export function isAcceptedSignalDate(signalDate: unknown, sessionDate: string): boolean {
  return validDate(signalDate) && validDate(sessionDate) &&
    (signalDate === sessionDate || signalDate === previousTradingDate(sessionDate));
}