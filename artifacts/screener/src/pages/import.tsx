import { useState } from "react";
import { useImportSession, getListSessionsQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Terminal, Upload, AlertTriangle, RefreshCw, X, ShieldAlert, Zap, CheckCircle2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type AffectedOutcome = {
  ticker: string;
  category: string;
  outcome: "WIN" | "LOSS" | "SKIP";
  exitPrice: number | null;
};

type ConflictInfo = {
  sessionId: number;
  date: string;
  affectedOutcomes: AffectedOutcome[];
  rawText: string;
};

const OUTCOME_COLORS: Record<string, string> = {
  WIN: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  LOSS: "text-red-400 bg-red-500/10 border-red-500/20",
  SKIP: "text-slate-400 bg-slate-500/10 border-slate-500/20",
};

type EdgeAIStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; setupCount: number; date: string; generatedAt: string }
  | { kind: "error"; message: string };

export function Import() {
  const [rawText, setRawText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [edgeStatus, setEdgeStatus] = useState<EdgeAIStatus>({ kind: "idle" });
  const [, setLocation] = useLocation();
  const importSession = useImportSession();
  const queryClient = useQueryClient();

  const runImport = (text: string, force: boolean) => {
    setError(null);
    importSession.mutate(
      { data: { rawText: text, force } },
      {
        onSuccess: (data) => {
          queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
          setLocation(`/sessions/${data.id}`);
        },
        onError: (err: any) => {
          // 409 conflict with outcome details → show confirmation modal
          if (err?.sessionId !== undefined && Array.isArray(err?.affectedOutcomes)) {
            setConflict({
              sessionId: err.sessionId,
              date: err.date,
              affectedOutcomes: err.affectedOutcomes,
              rawText: text,
            });
          } else {
            setError(err?.error || "Failed to parse and import session. Check format.");
          }
        },
      }
    );
  };

  const handleImport = () => {
    if (!rawText.trim()) {
      setError("Please paste screener output first.");
      return;
    }
    runImport(rawText, false);
  };

  const handleForceReimport = () => {
    if (!conflict) return;
    setConflict(null);
    runImport(conflict.rawText, true);
  };

  const handleEdgeAIImport = async (force = false) => {
    setEdgeStatus({ kind: "loading" });
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/screener/sessions/import-from-edgeai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (res.status === 409) {
        // Reuse the same conflict modal as manual import
        setConflict({
          sessionId: data.sessionId,
          date: data.date,
          affectedOutcomes: data.affectedOutcomes,
          rawText: "__edgeai__", // sentinel — not used for edge import
        });
        setEdgeStatus({ kind: "idle" });
        return;
      }
      if (!res.ok) {
        setEdgeStatus({ kind: "error", message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
      setEdgeStatus({ kind: "success", setupCount: data.setupCount, date: data.date, generatedAt: data.generatedAt });
      setTimeout(() => setLocation(`/sessions/${data.id}`), 1200);
    } catch (e: any) {
      setEdgeStatus({ kind: "error", message: e.message ?? "Nätverksfel" });
    }
  };

  // Override force-reimport so both EdgeAI and manual conflicts work from same modal
  const handleForceFromConflict = () => {
    if (!conflict) return;
    if (conflict.rawText === "__edgeai__") {
      setConflict(null);
      handleEdgeAIImport(true);
    } else {
      handleForceReimport();
    }
  };

  const loggedOutcomes = conflict?.affectedOutcomes.filter((o) => o.outcome !== "SKIP") ?? [];
  const skipped = conflict?.affectedOutcomes.filter((o) => o.outcome === "SKIP") ?? [];

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header>
        <h2 className="text-3xl font-bold tracking-tight">Import Screener Data</h2>
        <p className="text-muted-foreground mt-1">Paste the raw text output from your daily screener tool.</p>
      </header>

      {/* ── EdgeAI auto-import card ── */}
      <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-blue-500/10 rounded-lg shrink-0">
            <Zap className="w-5 h-5 text-blue-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">Importera från EdgeAI</p>
            <p className="text-xs text-muted-foreground truncate">
              Hämtar dagens SE-setups direkt från{" "}
              <span className="font-mono text-blue-400/80">edgeai/public/data.json</span>
              {edgeStatus.kind === "success" && (
                <span className="text-emerald-400 ml-1">
                  · {edgeStatus.setupCount} setups ({edgeStatus.date})
                </span>
              )}
              {edgeStatus.kind === "error" && (
                <span className="text-red-400 ml-1">· {edgeStatus.message}</span>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={() => handleEdgeAIImport(false)}
          disabled={edgeStatus.kind === "loading"}
          className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          data-testid="btn-edgeai-import"
        >
          {edgeStatus.kind === "loading" ? (
            <span className="animate-pulse">Hämtar…</span>
          ) : edgeStatus.kind === "success" ? (
            <><CheckCircle2 className="w-4 h-4" /> Importerad</>
          ) : (
            <><Zap className="w-4 h-4" /> Hämta & importera</>
          )}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive border border-destructive/20 rounded-md flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden flex flex-col">
        <div className="bg-muted px-4 py-2 border-b border-border flex items-center gap-2 text-xs font-mono text-muted-foreground">
          <Terminal className="w-4 h-4" />
          RAW_INPUT.txt
        </div>
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder={`Klistra in screener-texten här. Formatet ska innehålla:

SCREENER · YYYY-MM-DD

MARKNADSVÄDER  OMXS30 3305.0 | 5d  2.7% | 1m  1.8% | 3m  8.9% | RSI  79
→ MEDVIND

=== 1 · MOMENTUM — ...===
1. SSAB   102.85 | RS3m  18.5 | 1m  9.4% | RSI  57 | %B  0.90 | ATR  3.3% | vol  0.2x | ↔20dH  -0.3%
      plan(LONG): entry ~102.85 · stop 98.83 (1.2×ATR) · mål +1% 103.88 (R/R 0.26) · 1R 106.87

=== 2 · SQUEEZE — ...===
...`}
          className="w-full h-[500px] p-4 bg-transparent font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
          spellCheck={false}
          data-testid="input-raw-text"
        />
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleImport}
          disabled={importSession.isPending}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background bg-primary text-primary-foreground hover:bg-primary/90 h-11 px-8 shadow-sm"
          data-testid="btn-parse-import"
        >
          {importSession.isPending ? (
            <span className="animate-pulse">Parsing...</span>
          ) : (
            <>
              <Upload className="w-4 h-4 mr-2" />
              Parse & Import
            </>
          )}
        </button>
      </div>

      {/* ── Conflict confirmation modal ── */}
      {conflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-start justify-between p-5 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/10 rounded-lg">
                  <ShieldAlert className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-base">Session already exists</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{conflict.date}</p>
                </div>
              </div>
              <button
                onClick={() => setConflict(null)}
                className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">
              {conflict.affectedOutcomes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No outcomes have been logged yet. Re-importing will replace all candidates.
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    The following outcomes are already logged. They will be{" "}
                    <span className="text-foreground font-medium">preserved</span> on re-import
                    if the ticker still appears in the new screener output.
                  </p>

                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {conflict.affectedOutcomes.map((o) => (
                      <div
                        key={`${o.ticker}-${o.outcome}`}
                        className="flex items-center justify-between rounded-md px-3 py-2 bg-muted/50 border border-border text-sm"
                      >
                        <span className="font-mono font-medium">{o.ticker}</span>
                        <div className="flex items-center gap-2">
                          {o.exitPrice != null && (
                            <span className="text-xs text-muted-foreground">
                              exit {o.exitPrice.toFixed(2)}
                            </span>
                          )}
                          <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded border ${OUTCOME_COLORS[o.outcome] ?? ""}`}
                          >
                            {o.outcome}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {loggedOutcomes.length > 0 && (
                    <p className="text-xs text-amber-400/80 flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      Tickers that disappear from the new screener output will lose their
                      logged outcomes permanently.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-5 py-4 border-t border-border">
              <button
                onClick={() => setConflict(null)}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-4 border border-border bg-transparent hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleForceFromConflict}
                disabled={importSession.isPending}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-4 bg-amber-500 text-black hover:bg-amber-400 transition-colors disabled:opacity-50"
                data-testid="btn-confirm-reimport"
              >
                {importSession.isPending ? (
                  <span className="animate-pulse">Re-importing…</span>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                    Re-import anyway
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
