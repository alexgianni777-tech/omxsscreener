// Pure presentation helpers. Never use the output for calculations.
const fmt = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function two(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? fmt.format(n) : "okänt";
}
export const formatPrice = (n: number | null | undefined): string => two(n);
export const formatRR = (n: number | null | undefined): string => two(n);
