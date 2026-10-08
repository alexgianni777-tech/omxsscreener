import { createHash } from "node:crypto";
import { isAcceptedSignalDate, stockholmSignalDate } from "./signalDatePolicy";
import { normalizeImportSymbol } from "./candidateSynchronizationPolicy";
export { normalizeImportSymbol } from "./candidateSynchronizationPolicy";

export class ImportDataError extends Error {
  constructor(message: string, public report?: ImportReport) { super(message); }
}
export type ImportReport = {
  source: string; fingerprint: string; signalDate: string; reportDate: string;
  generatedAt: string | null; dataDates: { SE: string | null; US: string | null };
  status?: "SUCCESS" | "FAILED"; error?: string | null;
  quarantinedIdentities?: string[]; warnings?: string[];
};
function canonical(value: unknown, market = "SE", field = ""): unknown {
  if (Array.isArray(value)) {
    const items = value.map(v => canonical(v, market));
    return ["setups", "candidates"].includes(field) ? items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : items;
  }
  if (value && typeof value === "object") {
    const declaredMarket = (value as { market?: unknown }).market;
    const localMarket = declaredMarket === "US" || declaredMarket === "SE" ? declaredMarket : market;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !["generatedAt", "importedAt", "fetchedAt"].includes(key))
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [
        key, ["ticker", "symbol"].includes(key) && typeof v === "string" ? normalizeImportSymbol(v, localMarket) : canonical(v, key === "US" ? "US" : key === "SE" ? "SE" : localMarket, key),
      ]));
  }
  return value;
}
/** Fingerprint the source report BEFORE any Yahoo enrichment or manual calendar observation. */
export function makeImportReport(source: string, signalDate: string, input: unknown, generatedAt: string | null = null,
  dataDates: ImportReport["dataDates"] = { SE: null, US: null }): ImportReport {
  if (!isAcceptedSignalDate(signalDate, signalDate)) throw new ImportDataError("Importen saknar giltigt signaldatum.");
  if (generatedAt != null && !Number.isFinite(Date.parse(generatedAt))) throw new ImportDataError("Rapporttidpunkten är ogiltig.");
  const reportDate = generatedAt && Number.isFinite(Date.parse(generatedAt))
    ? stockholmSignalDate(new Date(generatedAt)) : signalDate;
  for (const date of Object.values(dataDates)) {
    if (date != null && (!isAcceptedSignalDate(date, date) || date > reportDate)) throw new ImportDataError("Datadag är ogiltig eller ligger efter rapportdagen. Ingen import har sparats.");
  }
  const fingerprint = "v2:" + createHash("sha256").update(JSON.stringify({ processorVersion: "isolated-edgeai-plans", source, signalDate, reportDate, dataDates, input: canonical(input) })).digest("hex");
  return { source, signalDate, reportDate, generatedAt, dataDates, fingerprint, status: "SUCCESS" };
}
