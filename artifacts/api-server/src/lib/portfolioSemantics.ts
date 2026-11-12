export type PositionSide = "LONG" | "SHORT";

/**
 * Legacy broker instrument labels identify leveraged products and their
 * underlying direction, while open-position rows represent held products.
 * Only infer ownership for a recognizable product label with an explicit L/S
 * marker; leave arbitrary/ambiguous instrument text unknown.
 */
export function inferOwnedLeveragedProductSide(instrument: string | null | undefined): "LONG" | null {
  return instrument && /^(?:MINI|TURBO|BULL|BEAR)\s+[LS]\s+\S+/i.test(instrument.trim())
    ? "LONG"
    : null;
}

/**
 * Product P&L follows the position held in the quoted product. Leverage is
 * metadata only; the product quote already reflects its leveraged movement.
 * Rows predating explicit productSide retain their historical direction rule.
 */
export function calculateProductPnl(
  entryPrice: number,
  livePrice: number,
  shares: number,
  productSide: PositionSide | null | undefined,
  legacyDirection: PositionSide,
  instrument?: string | null,
): { unrealisedKr: number; unrealisedPct: number } {
  const effectiveSide = productSide ?? inferOwnedLeveragedProductSide(instrument) ?? legacyDirection;
  const isShortProduct = effectiveSide === "SHORT";
  const priceDelta = isShortProduct ? entryPrice - livePrice : livePrice - entryPrice;
  return {
    unrealisedKr: priceDelta * shares,
    unrealisedPct: (priceDelta / entryPrice) * 100,
  };
}

export function countUnderlyingDirections(
  directions: Array<PositionSide | null | undefined>,
): { underlyingLongCount: number; underlyingShortCount: number; underlyingDirectionUnknownCount: number } {
  return directions.reduce(
    (counts, direction) => {
      if (direction === "LONG") counts.underlyingLongCount++;
      else if (direction === "SHORT") counts.underlyingShortCount++;
      else counts.underlyingDirectionUnknownCount++;
      return counts;
    },
    { underlyingLongCount: 0, underlyingShortCount: 0, underlyingDirectionUnknownCount: 0 },
  );
}