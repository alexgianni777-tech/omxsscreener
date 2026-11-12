/**
 * Maps the screener's display names to Yahoo Finance ticker symbols (.ST suffix).
 * The screener uses short company names; Yahoo Finance uses exchange tickers.
 */
export const OMXS30_TICKER_MAP: Record<string, string> = {
  // ── A ──
  ABB: "ABB.ST",
  "Alfa Laval": "ALFA.ST",
  "Atlas Copco": "ATCO-A.ST",
  Autoliv: "ALIV-SDB.ST",
  AstraZeneca: "AZN.ST",

  // ── B ──
  Boliden: "BOL.ST",

  // ── E ──
  Electrolux: "ELUX-B.ST",
  Epiroc: "EPIR-A.ST",
  Ericsson: "ERIC-B.ST",
  Essity: "ESSITY-B.ST",
  Evolution: "EVO.ST",

  // ── G ──
  Getinge: "GETI-B.ST",

  // ── H ──
  Handelsbanken: "SHB-A.ST",
  Hexagon: "HEXA-B.ST",
  "H&M": "HM-B.ST",
  Husqvarna: "HUSQ-B.ST",

  // ── I ──
  Investor: "INVE-B.ST",

  // ── K ──
  Kinnevik: "KINV-B.ST",

  // ── N ──
  Nibe: "NIBE-B.ST",
  Nordea: "NDA-SE.ST",

  // ── S ──
  Saab: "SAAB-B.ST",
  Sandvik: "SAND.ST",
  SEB: "SEB-A.ST",
  Sinch: "SINCH.ST",
  SKF: "SKF-B.ST",
  SSAB: "SSAB-B.ST",
  Swedbank: "SWED-A.ST",
  "Swedish Match": "SWMA.ST",

  // ── T ──
  Telia: "TELIA.ST",

  // ── V ──
  "Volvo": "VOLV-B.ST",
};

/**
 * Swedish base tickers that arrive stripped of .ST (e.g. from EdgeAI imports).
 * These need .ST re-added for Yahoo Finance. Explicit known Swedish share
 * classes are handled separately; a generic hyphen never implies Sweden.
 */
const SE_BASE_TICKERS = new Set([
  "ABB", "ALFA", "AZN", "BOL", "EVO",
  "SAND", "SINCH", "SWMA", "TELIA",
]);

/**
 * Resolve a ticker to a Yahoo Finance symbol.
 *
 * Priority order:
 * Explicit market and share class take precedence. Ambiguous Swedish aliases
 * require instrument verification rather than choosing an A/B class.
 */
const SWEDISH_CLASS_BASES = new Set([
  "SCA", "SSAB", ...Object.values(OMXS30_TICKER_MAP)
    .filter(symbol => /-[AB]\.ST$/.test(symbol)).map(symbol => symbol.replace(/-[AB]\.ST$/, "")),
]);
const AMBIGUOUS_ALIASES = new Set([
  "SCA", ...Object.entries(OMXS30_TICKER_MAP)
    .filter(([, symbol]) => /-[AB]\.ST$/.test(symbol)).map(([name]) => name.toUpperCase()),
  ...SWEDISH_CLASS_BASES,
]);

export class InstrumentVerificationError extends Error {}

/** Never infer a Swedish share class, or Sweden merely from a hyphen. */
export function resolveYahooTicker(screenerTicker: string, market?: string | null): string {
  const ticker = screenerTicker.trim();
  const upper = ticker.toUpperCase();
  const reject = (): never => {
    throw new InstrumentVerificationError(`${ticker}: kräver instrumentverifiering — ange marknad och exakt aktieslag.`);
  };
  if (market === "US") return upper.endsWith(".ST") ? reject() : upper;
  // These bare symbols also occur on other exchanges (e.g. ABB/ABB.ST).
  if (!market && SE_BASE_TICKERS.has(upper)) return reject();
  const explicitClass = upper.match(/^([A-Z0-9]+)[ -]([AB])(?:\.ST)?$/);
  if (explicitClass && SWEDISH_CLASS_BASES.has(explicitClass[1])) {
    return `${explicitClass[1]}-${explicitClass[2]}.ST`;
  }
  if (AMBIGUOUS_ALIASES.has(upper) || SWEDISH_CLASS_BASES.has(upper.replace(/\.ST$/, ""))) return reject();
  if (upper.endsWith(".ST")) return upper;
  if (OMXS30_TICKER_MAP[ticker]) return OMXS30_TICKER_MAP[ticker];
  if (SE_BASE_TICKERS.has(upper)) return `${upper}.ST`;
  if (upper === "NDA-SE" || upper === "ALIV-SDB") return `${upper}.ST`;
  if (market === "SE") return reject();
  return ticker; // e.g. BRK-B stays US; an unknown hyphen is not evidence of Sweden.
}

/** Market-qualified identity in the existing comma-separated ticker parameter.
 * Preserve this request identity in the quote response, so SE:ABB and US:ABB
 * cannot overwrite each other's prices or React Query cache entries.
 */
export function resolveQuoteTicker(requestTicker: string): string {
  const qualified = requestTicker.match(/^(SE|US):(.+)$/);
  if (qualified) return resolveYahooTicker(qualified[2], qualified[1]);
  if (requestTicker.includes(":")) throw new InstrumentVerificationError("Kräver instrumentverifiering — marknad ska vara SE eller US.");
  return resolveYahooTicker(requestTicker);
}
