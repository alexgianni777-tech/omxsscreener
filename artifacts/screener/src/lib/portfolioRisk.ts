import type { PortfolioPosition } from "@workspace/api-client-react";
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const positive = (n: unknown): n is number => finite(n) && n > 0;
const bankSymbols = new Set(["C", "BAC"]);

/** Read-only model units: portfolio DTO has no instrument currency/FX evidence. */
export function portfolioRisk(positions: readonly PortfolioPosition[]) {
  const rows = positions.map(p => {
    const product = !!p.instrument || (!!p.productType && p.productType !== "SHARE");
    const side = product ? p.productSide : p.direction;
    const entryValue = p.entryPrice * p.shares;
    const capital = positive(p.entryPrice) && positive(p.shares) && positive(entryValue) && finite(p.positionSizeKr) &&
      Math.abs(p.positionSizeKr - entryValue) <= 1e-7 * Math.max(1, entryValue)
      ? p.positionSizeKr : null;
    const stopValue = positive(p.stopPrice) && positive(p.entryPrice) && positive(p.shares) &&
      (side === "LONG" || side === "SHORT")
      ? Math.max(0, (side === "LONG" ? p.entryPrice - p.stopPrice : p.stopPrice - p.entryPrice) * p.shares) : null;
    const stop = finite(stopValue) ? stopValue : null;
    // Never use the underlying SHORT direction for a bought bearish product.
    const maximum = side === "LONG" ? capital : null;
    const underlying = (p.underlyingTicker ?? p.ticker).trim().toUpperCase().replace(/^(NYSE:|NASDAQ:)/, "");
    return { id: p.id, ticker: p.ticker, capital, stop, maximum, product, side,
      unbounded: side === "SHORT", bank: bankSymbols.has(underlying),
      leverage: positive(p.indicativeLeverage) ? p.indicativeLeverage : null,
      barrier: positive(p.barrierLevel) ? p.barrierLevel : null };
  });
  const total = (key: "capital" | "stop" | "maximum") => {
    const known = rows.filter(r => r[key] != null);
    const value = known.reduce((s, r) => s + r[key]!, 0);
    return { value: Number.isFinite(value) ? value : null, unknown: rows.length - known.length };
  };
  return { rows, capital: total("capital"), stop: total("stop"), maximum: total("maximum"),
    banks: rows.filter(r => r.bank).length, unknownSector: rows.filter(r => !r.bank).length };
}
