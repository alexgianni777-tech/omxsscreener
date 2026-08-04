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
 * Resolve a screener display name to a Yahoo Finance ticker.
 * Falls back to DISPLAYNAME.ST for any unmapped ticker.
 */
export function resolveYahooTicker(screenerTicker: string): string {
  return OMXS30_TICKER_MAP[screenerTicker] ?? `${screenerTicker}.ST`;
}
