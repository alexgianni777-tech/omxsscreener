import { CreateJournalRecordBody, ListJournalRecordsResponse } from "@workspace/api-zod";

export type JournalEntryInput = typeof CreateJournalRecordBody._output;
export type JournalRecord = (typeof ListJournalRecordsResponse._output)[number];
type JournalMetrics = JournalRecord["metrics"];

function validInstant(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const day = value.slice(0, 10);
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}

/** Prices are actual executions, spread/slippage observations are not deducted again. */
export function journalMetrics(input: JournalEntryInput, now = Date.now()): JournalMetrics {
  const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.id) || !Number.isSafeInteger(input.candidateId) || input.candidateId <= 0 || input.candidateId > 2147483647) {
    throw new Error("Ogiltig journalidentitet eller kandidat.");
  }
  for (const field of ["spreadCostKr", "slippageCostKr", "financingCostKr", "commissionKr"] as const) {
    const value = input[field];
    if (value != null && (!Number.isFinite(value) || value < 0)) throw new Error("Kostnader ska vara positiva eller noll; lämna okända kostnader tomma.");
  }
  if (input.leverage != null && !positive(input.leverage)) throw new Error("Hävstång måste vara positiv eller okänd.");
  if (input.mode === "NOT_TAKEN") {
    if (!input.notes.trim()) throw new Error("Ange varför traden uteblev.");
    for (const field of ["instrumentKind", "side", "entryTime", "fillPrice", "stopPrice", "targetPrice", "exitTime", "exitPrice", "quantity", "leverage", "priceCurrency", "entryFxSek", "exitFxSek", "spreadCostKr", "slippageCostKr", "financingCostKr", "commissionKr"] as const) {
      if (input[field] != null) throw new Error("En utebliven trade får inte innehålla fills eller handelskostnader.");
    }
    return { grossR: null, netR: null, riskCashKr: null, netPnlKr: null };
  }
  if (input.mode !== "REAL" && input.mode !== "SIMULATED") throw new Error("Välj verklig, simulerad eller utebliven trade.");
  if (!["SHARE", "PRODUCT"].includes(input.instrumentKind ?? "") || !["LONG", "SHORT"].includes(input.side ?? "")) {
    throw new Error("Ange instrumenttyp och det handlade instrumentets sida.");
  }
  if (!["SEK", "USD"].includes(input.priceCurrency ?? "")) throw new Error("Ange instrumentprisernas valuta.");
  const { fillPrice: fill, stopPrice: stop, targetPrice: target, exitPrice: exit, quantity } = input;
  if (![fill, stop, target, exit, quantity].every(positive)) throw new Error("Fill, initial stop, target, exit och antal måste vara positiva.");
  const long = input.side === "LONG";
  // Historical bad/late executions must not disappear just because the plan was broken.
  const validRisk = long ? stop! < fill! : fill! < stop!;
  for (const stamp of [input.entryTime, input.exitTime]) {
    if (!validInstant(stamp)) throw new Error("Entry och exit behöver giltiga tidpunkter med tidszon.");
  }
  const entered = Date.parse(input.entryTime!);
  const exited = Date.parse(input.exitTime!);
  if (exited < entered || entered > now || exited > now) throw new Error("Exit får inte vara före entry och verkliga journalhändelser får inte ligga i framtiden.");
  const entryFx = input.priceCurrency === "SEK" ? 1 : input.entryFxSek;
  const exitFx = input.priceCurrency === "SEK" ? 1 : input.exitFxSek;
  if (!positive(entryFx) || !positive(exitFx)) throw new Error("USD-priser kräver uppmätt USD/SEK vid både entry och exit.");
  if (input.priceCurrency === "SEK" && ((input.entryFxSek != null && input.entryFxSek !== 1) || (input.exitFxSek != null && input.exitFxSek !== 1))) {
    throw new Error("SEK-priser har valutakurs 1.");
  }
  const riskCashKr = validRisk ? Math.abs(fill! - stop!) * quantity! * entryFx : null;
  const grossPnl = (long ? 1 : -1) * (exit! * exitFx - fill! * entryFx) * quantity!;
  const grossR = riskCashKr == null ? null : grossPnl / riskCashKr;
  if (!Number.isFinite(grossPnl) || (riskCashKr != null && (!Number.isFinite(riskCashKr) || riskCashKr <= 0)) || (grossR != null && !Number.isFinite(grossR))) throw new Error("Prisnivåerna ger ogiltig risk eller P&L.");
  const costsKnown = input.financingCostKr != null && input.commissionKr != null;
  const netPnlKr = costsKnown ? grossPnl - input.financingCostKr! - input.commissionKr! : null;
  const netR = netPnlKr == null || riskCashKr == null ? null : netPnlKr / riskCashKr;
  if ((netR != null && !Number.isFinite(netR)) || (netPnlKr != null && !Number.isFinite(netPnlKr))) throw new Error("Kostnaderna ger ogiltigt nettoresultat.");
  return { grossR, netR, riskCashKr, netPnlKr };
}

/** Null and omitted optional data mean unknown; input comparison is stable across JSON key order. */
export function journalInputKey(input: JournalEntryInput): string {
  return JSON.stringify(Object.entries(input).filter(([, value]) => value != null).sort(([a], [b]) => a.localeCompare(b)));
}
