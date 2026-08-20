import { useListSessions, getListSessionsQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { formatNumber, formatPct, formatDate } from "../lib/utils";
import { Trash2, ChevronRight, BarChart3, Activity } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

// Shape returned by GET /api/screener/sessions/:id/delete-impact
interface DeleteImpact {
  date: string;
  candidates: number;
  resolvedOutcomes: number;
  linkedChallengeTrades: number;
}

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/+$/, "");
const api = (path: string) => `${BASE}/api${path}`;

export function Sessions() {
  const { data: sessions, isLoading, isError } = useListSessions();
  const queryClient = useQueryClient();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  if (isLoading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-8 w-48 bg-muted rounded mb-8"></div>
      {[1,2,3].map(i => <div key={i} className="h-24 bg-muted rounded-lg"></div>)}
    </div>;
  }

  if (isError || !sessions) {
    return <div className="p-6 bg-destructive/10 text-destructive rounded-lg border border-destructive/20">
      Failed to load sessions.
    </div>;
  }

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.preventDefault();
    setDeleteError(null);

    // 1. Fetch impact
    let impact: DeleteImpact;
    try {
      const r = await fetch(api(`/screener/sessions/${id}/delete-impact`));
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setDeleteError(body.error ?? body.message ?? `Serverfel ${r.status}`);
        return;
      }
      impact = await r.json();
    } catch (err: any) {
      setDeleteError(err.message ?? "Nätverksfel vid hämtning av konsekvensinformation");
      return;
    }

    // 2. Build Swedish confirmation message with exact counts
    const lines: string[] = [
      `Ta bort session ${formatDate(impact.date)} permanent?`,
      "",
      `Detta raderar:`,
      `  • ${impact.candidates} kandidat${impact.candidates !== 1 ? "er" : ""}`,
    ];
    if (impact.resolvedOutcomes > 0) {
      lines.push(`  • ${impact.resolvedOutcomes} registrerat${impact.resolvedOutcomes !== 1 ? "e" : ""} utfall (WIN/LOSS/SKIP)`);
    }
    if (impact.linkedChallengeTrades > 0) {
      lines.push(`  • ${impact.linkedChallengeTrades} länkad${impact.linkedChallengeTrades !== 1 ? "e" : ""} challenge-trade${impact.linkedChallengeTrades !== 1 ? "s" : ""}`);
    }
    lines.push("", "Åtgärden kan inte ångras.");

    if (!confirm(lines.join("\n"))) return;

    // 3. Delete with ?force=true
    setDeleting(id);
    try {
      const r = await fetch(api(`/screener/sessions/${id}?force=true`), { method: "DELETE" });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setDeleteError(body.error ?? body.message ?? `Serverfel ${r.status}`);
        return;
      }
      queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
    } catch (err: any) {
      setDeleteError(err.message ?? "Nätverksfel vid borttagning");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {deleteError && (
        <div className="p-3 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-sm">
          Kunde inte radera sessionen: {deleteError}
        </div>
      )}
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Screener Sessions</h2>
        <Link 
          href="/import"
          className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4"
        >
          Import New
        </Link>
      </div>

      {sessions.length === 0 ? (
        <div className="text-center py-12 border border-dashed rounded-lg bg-card text-muted-foreground">
          <Activity className="mx-auto h-12 w-12 opacity-20 mb-4" />
          <p>No sessions found.</p>
          <Link href="/import" className="text-primary hover:underline mt-2 inline-block">Import your first screener output</Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {sessions.map(session => (
            <Link key={session.id} href={`/sessions/${session.id}`} className="block group">
              <div className="bg-card border border-border rounded-lg p-5 shadow-sm hover:border-primary/50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4">
                
                {/* Date and Weather */}
                <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Session Date</div>
                    <div className="font-bold text-lg">{formatDate(session.date)}</div>
                  </div>
                  
                  <div className="h-10 w-px bg-border hidden sm:block"></div>
                  
                  <div>
                    <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                      <BarChart3 className="w-3 h-3" /> OMXS30
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono font-bold">{formatNumber(session.marketWeather.omxsValue, 1)}</span>
                      <span className={`text-xs font-mono font-medium px-1.5 py-0.5 rounded ${
                        session.marketWeather.perf1m > 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                      }`}>
                        {session.marketWeather.perf1m > 0 ? "+" : ""}{formatPct(session.marketWeather.perf1m)} 1m
                      </span>
                    </div>
                  </div>
                </div>

                {/* Candidate Counts */}
                <div className="flex items-center gap-4 text-sm">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs font-mono bg-muted rounded-md p-2 min-w-[240px]">
                    <div><span className="text-muted-foreground block mb-0.5">MOM</span>{session.momentumCount}</div>
                    <div><span className="text-muted-foreground block mb-0.5">SQZ</span>{session.squeezeCount}</div>
                    <div><span className="text-muted-foreground block mb-0.5">STD</span>{session.studsCount}</div>
                    <div><span className="text-muted-foreground block mb-0.5">WEAK</span>{session.weakestCount}</div>
                  </div>
                  
                  <div className="flex flex-col items-end">
                    <span className="text-muted-foreground text-xs">Tracked</span>
                    <span className="font-mono font-bold">{session.trackedCount}/{session.totalCandidates}</span>
                  </div>

                  <button 
                    onClick={(e) => handleDelete(session.id, e)}
                    disabled={deleting === session.id}
                    className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors disabled:opacity-40"
                    aria-label="Delete session"
                    title="Delete session"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
