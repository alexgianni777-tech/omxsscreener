/** Presentation only. Never used to qualify a signal or remove a blocker. */
export function summarizeResearchWarnings(
  input: readonly string[],
  context: {stale: boolean; dataDate?: string | null; expectedDataDate?: string | null},
) {
  const audit = [...new Set(input.map(s=>s.trim()).filter(Boolean))];
  const seen = new Set<string>();
  const details = audit.filter(reason=>{
    const topic = /^UNKNOWN_REPORT_DATE|^Rapportkontroll:\s*UNKNOWN_REPORT_DATE/.test(reason) ? "unknown-report"
      : /^ATR för underliggande/.test(reason) ? "atr"
      : /^(STALE\/UNKNOWN_DATA_DATE|Signal eller marknadsdag är STALE)/.test(reason) ? "date"
      : reason;
    if (context.stale && topic==="date") return false;
    if (seen.has(topic)) return false;
    seen.add(topic);
    return !/^Screeningkvalificering är inte verifierad/.test(reason) || audit.length===1;
  });
  const primary = context.stale
    ? `Historiskt underlag: ${context.dataDate??"datadag ej verifierad"}.${context.expectedDataDate?` För aktuell D−1 krävs ${context.expectedDataDate}.`:""} Ingen ny entry.`
    : details.shift() ?? "Kontrollera datakvalitet och livekurs före eget beslut.";
  return {primary,details,audit};
}
