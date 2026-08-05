import { format, parseISO } from "date-fns";

export function formatNumber(val: number | null | undefined, decimals = 2): string {
  if (val === null || val === undefined) return "-";
  return val.toFixed(decimals);
}

/** For values stored as fractions (0–1), e.g. win rate */
export function formatPercent(val: number | null | undefined): string {
  if (val === null || val === undefined) return "-";
  return `${(val * 100).toFixed(1)}%`;
}

/** For values already in percent form, e.g. perf1m=2.7 means 2.7% */
export function formatPct(val: number | null | undefined, decimals = 1): string {
  if (val === null || val === undefined) return "-";
  return `${val.toFixed(decimals)}%`;
}

export function formatDate(dateString: string): string {
  try {
    return format(parseISO(dateString), "MMM d, yyyy");
  } catch (e) {
    return dateString;
  }
}
