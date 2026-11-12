export interface BrokerImportRow {
  id: string;
  instrument: string;
  direction: "LONG" | "SHORT";
  productSide: "LONG";
  underlyingDirection: "LONG" | "SHORT";
  shares: number;
  livePrice: number;
  entryPrice: number;
  pnlKr: number;
  pnlPct: number;
  marketValueKr: number;
  ticker: string;
}

function parseBrokerNumber(value: string) {
  return Number(value.replace(/\s/g, "").replace(",", "."));
}

export function parseBrokerExport(text: string): { rows: BrokerImportRow[]; errors: string[] } {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.replace(/\u00a0/g, " ").trim())
    .filter(Boolean);
  const rows: BrokerImportRow[] = [];
  const errors: string[] = [];
  const instrumentPattern = /^(?:MINI|TURBO|BULL|BEAR)\b/i;
  const rowPattern = /^(\d+(?:[.,]\d+)?)\s+.*?\b\d{1,2}:\d{2}\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s+SEK\s+([+\-−]?\d[\d\s]*(?:[.,]\d+)?)\s+kr\s+([+\-−]?\d+(?:[.,]\d+)?)%\s+([\d\s.,]+)\s+kr$/i;

  for (let index = 0; index < lines.length; index++) {
    const instrument = lines[index];
    if (!instrumentPattern.test(instrument)) continue;

    const dataLine = lines[index + 1];
    const match = dataLine?.replace(/−/g, "-").match(rowPattern);
    if (!match) {
      errors.push(`Kunde inte läsa värdena efter “${instrument}”.`);
      continue;
    }

    const shares = parseBrokerNumber(match[1]);
    const livePrice = parseBrokerNumber(match[2]);
    const entryPrice = parseBrokerNumber(match[3]);
    const pnlKr = parseBrokerNumber(match[4]);
    const pnlPct = parseBrokerNumber(match[5]);
    const marketValueKr = parseBrokerNumber(match[6]);
    if ([shares, livePrice, entryPrice, pnlKr, pnlPct, marketValueKr].some(value => !Number.isFinite(value))) {
      errors.push(`Ogiltiga siffror efter “${instrument}”.`);
      continue;
    }

    const underlyingDirection = /^(?:MINI|TURBO|BULL|BEAR)\s+S\b/i.test(instrument) ? "SHORT" : "LONG";
    rows.push({
      id: `${instrument}-${index}`,
      instrument,
      direction: underlyingDirection,
      productSide: "LONG",
      underlyingDirection,
      shares,
      livePrice,
      entryPrice,
      pnlKr,
      pnlPct,
      marketValueKr,
      ticker: "",
    });
    index++;
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push("Hittade inga instrumentrader. Klistra in instrumentnamn och raden med antal, kurser och värde.");
  }
  return { rows, errors };
}