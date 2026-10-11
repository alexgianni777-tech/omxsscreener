import "./_group.css";
import { RiskPanel } from "./_RiskPanel";

// TESTDATA: arbitrary round fixture numbers, not market prices, not a recommendation.
const TESTDATA_LONG = { direction: "LONG", entryPrice: 100, stopPrice: 95, targetPrice: 110 };
const EMPTY_PLAN = { direction: "LONG", entryPrice: 0, stopPrice: 0, targetPrice: 0 };

export function MobileSafety() {
  return (
    <div className="asr-scope min-h-screen p-3 space-y-3" style={{ maxWidth: 420 }}>
      <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "hsl(var(--destructive))" }}>
        TESTDATA · isolerad förhandsvisning av RiskPanel · inga marknadsdata
      </p>
      <section className="rounded-lg border p-3" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
        <h3 className="text-sm font-semibold">TESTDATA-plan (LONG)</h3>
        <RiskPanel plan={TESTDATA_LONG} />
      </section>
      <section className="rounded-lg border p-3" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
        <h3 className="text-sm font-semibold">Tom/ogiltig plan</h3>
        <RiskPanel plan={EMPTY_PLAN} instrument="PRODUCT" />
      </section>
    </div>
  );
}
