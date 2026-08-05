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
 * These need .ST re-added for Yahoo Finance. Tickers containing a hyphen
 * (ERIC-B, SSAB-B, etc.) are handled by the hyphen rule below.
 */
const SE_BASE_TICKERS = new Set([
  "ABB", "ALFA", "AZN", "BOL", "EVO",
  "SAND", "SINCH", "SWMA", "TELIA",
]);

/**
 * Resolve a ticker to a Yahoo Finance symbol.
 *
 * Priority order:
 *  1. Display-name map (manually pasted SE stock names like "Alfa Laval")
 *  2. Already a full Yahoo ticker ending in .ST → return as-is
 *  3. Known SE base ticker (stripped from .ST by EdgeAI import) → add .ST
 *  4. Contains a Nordic hyphen class suffix (ERIC-B, SSAB-B, NDA-SE) → add .ST
 *  5. Everything else (US stocks: AMD, ABBV, SBUX…) → return as-is
 */
export function resolveYahooTicker(screenerTicker: string): string {
  if (OMXS30_TICKER_MAP[screenerTicker]) return OMXS30_TICKER_MAP[screenerTicker];
  if (screenerTicker.endsWith(".ST")) return screenerTicker;
  if (SE_BASE_TICKERS.has(screenerTicker)) return `${screenerTicker}.ST`;
  if (screenerTicker.includes("-")) return `${screenerTicker}.ST`;
  return screenerTicker; // US or other market — use as-is
}
