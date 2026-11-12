import { useState } from "react";
import { Briefcase, X, AlertTriangle, CheckCircle2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const api = (path: string) => `${BASE}/api${path}`;

export interface PortfolioPrefill {
  ticker: string;
  direction: "LONG" | "SHORT";
  market?: string | null;
  entryPrice: number;
  stopPrice?: number | null;
  targetPrice?: number | null;
}

/**
 * Quick "add to portfolio" dialog, pre-filled from a screener candidate. Only
 * asks for what the candidate can't already provide: quantity (and, since a
 * position is often bought via a leveraged instrument rather than the
 * underlying, an optional instrument name).
 */
export function AddToPortfolioModal({ prefill, onClose, onSuccess }: {
  prefill: PortfolioPrefill;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [shares, setShares] = useState("");
  const [instrument, setInstrument] = useState("");
  const [entryPrice, setEntryPrice] = useState(String(prefill.entryPrice));
  const [stopPrice, setStopPrice] = useState(prefill.stopPrice ? String(prefill.stopPrice) : "");
  const [targetPrice, setTargetPrice] = useState(prefill.targetPrice ? String(prefill.targetPrice) : "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    const parsedShares = parseFloat(shares);
    const parsedEntry = parseFloat(entryPrice);
    if (!shares || !isFinite(parsedShares) || parsedShares <= 0) {
      setError("Ange antal aktier.");
      return;
    }
    if (!entryPrice || !isFinite(parsedEntry) || parsedEntry <= 0) {
      setError("Ange ett giltigt entry-pris.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(api("/portfolio"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: prefill.ticker,
          instrument: instrument.trim() || undefined,
          direction: prefill.direction,
          entryPrice: parsedEntry,
          shares: parsedShares,
          stopPrice: stopPrice ? parseFloat(stopPrice) : undefined,
          targetPrice: targetPrice ? parseFloat(targetPrice) : undefined,
          market: prefill.market ?? undefined,
          notes: "Från screener-förslag",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Fel ${res.status}`);
        return;
      }
      setDone(true);
      onSuccess();
      setTimeout(onClose, 900);
    } catch (e: any) {
      setError(e?.message ?? "Nätverksfel");
    } finally {
      setSubmitting(false);
    }
  };

  const inp = "w-full bg-background border border-border rounded-md px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary";
  const label = "text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-primary" /> Lägg till {prefill.ticker.replace(/\.ST$/i, "")} i portföljen
          </h3>
          <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {done ? (
          <div className="flex items-center gap-2 text-success text-sm py-4">
            <CheckCircle2 className="h-4 w-4" /> Tillagd i portföljen.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className={label}>Riktning</label>
                <div className="px-3 py-2 text-sm rounded-md bg-muted text-muted-foreground">
                  {prefill.direction === "SHORT" ? "▼ SHORT" : "▲ LONG"} {prefill.market ? `· ${prefill.market}` : ""}
                </div>
              </div>
              <div>
                <label className={label}>Antal aktier *</label>
                <input className={inp} type="number" placeholder="100" value={shares} onChange={(e) => setShares(e.target.value)} autoFocus />
              </div>
              <div>
                <label className={label}>Entry-pris *</label>
                <input className={inp} type="number" step="0.01" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} />
              </div>
              <div>
                <label className={label}>Köpt verktyg (valfritt)</label>
                <input className={inp} placeholder="t.ex. MINI L HEXAGON AVA 32" value={instrument} onChange={(e) => setInstrument(e.target.value)} />
              </div>
              <div>
                <label className={label}>Stop-pris</label>
                <input className={inp} type="number" step="0.01" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} />
              </div>
              <div>
                <label className={label}>Målkurs</label>
                <input className={inp} type="number" step="0.01" value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} />
              </div>
            </div>
            {error && (
              <div className="mb-3 text-xs text-destructive flex items-center gap-2">
                <AlertTriangle className="h-3 w-3 shrink-0" />{error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-3 py-2 text-sm rounded-md text-muted-foreground hover:bg-muted transition-colors">
                Avbryt
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                Lägg till
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
