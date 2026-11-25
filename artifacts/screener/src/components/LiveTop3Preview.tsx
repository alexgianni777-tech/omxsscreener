import React from "react";
import { quoteRequestTicker } from "../lib/researchQuote";
import { Link } from "wouter";
import { d1Freshness, isTradingDay, previousMarketDay, validMarketDate } from "@workspace/market-calendar";
import type { CandidateDataQuality, Top3LiveSelection } from "@workspace/api-client-react";
import { CheckCircle2, AlertTriangle, ChevronRight } from "lucide-react";
import { LiveEntryGuard } from "./LiveEntryGuard";
import type { EntryQuote } from "../lib/liveEntryGuard";
import { PlanGrid } from "./PlanGrid";
import { filterActiveOmxs30Picks, filterArchivedOmxs30Picks } from "../lib/omxs30ActiveView";

export type LiveSelection = Top3LiveSelection;
type Cand = {
  id: number;
  ticker: string;
  market?: string | null;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  rr: number;
  dataQuality?: CandidateDataQuality | null;
  signalDate?: string | null;
  signalSource?: string | null;
  signalAgeBars?: number | null;
  decision?: { status: string; reasons: string[] };
  officialSelection?: {
    selected: boolean;
    rank: number | null;
    score: number;
    market: "SE" | "US" | null;
    direction: "LONG" | "SHORT";
    source: string | null;
    decision?: { status: string; reasons: string[] };
  } | null;
};
type Frozen = {
  requiredSources: string[];
  participatingSources: string[] | null;
  available: boolean;
  state?: string;
  unavailableReason?: string | null;
} | undefined;

export const DECISION_CLS: Record<string, string> = {
  TRADEABLE: "text-success bg-success/10 border-success/30",
  WAIT: "text-amber-600 bg-amber-500/10 border-amber-500/30",
  BLOCKED: "text-destructive bg-destructive/10 border-destructive/30",
  INVALID: "text-destructive bg-destructive/10 border-destructive/30",
  CONFLICT: "text-destructive bg-destructive/10 border-destructive/30",
  STALE: "text-amber-600 bg-amber-500/10 border-amber-500/30",
};
export const DECISION_TXT: Record<string, string> = {
  TRADEABLE: "TRADEABLE",
  WAIT: "WAIT",
  BLOCKED: "BLOCKED",
  INVALID: "BLOCKED",
  CONFLICT: "BLOCKED",
  STALE: "WAIT",
};

export function DecisionBadge({ decision }: { decision?: { status: string; reasons: string[] } }) {
  if (!decision) return null;
  return (
    <span
      data-testid="status-decision"
      title={`Screeningstatus, inte live-entrybesked: ${decision.status}${decision.reasons.length ? ": " + decision.reasons.join(" ") : ""}`}
      aria-label={`Screeningstatus ${decision.status}, inte live-entrybesked. ${decision.reasons.join(" ")}`}
      className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${DECISION_CLS[decision.status] ?? ""}`}
    >
      Screening · {DECISION_TXT[decision.status] ?? decision.status}
    </span>
  );
}

const NAMES = { telegram: "Telegram", edgeai: "EdgeAI" } as const;

type PreviewPick = LiveSelection["picks"][number];
type PreviewArchiveRow = { pick: PreviewPick; candidate?: Cand; reason: string };

/** Dated OMXS30 membership and verified D−1 data are required for the active groups. */
export function partitionLiveTop3Picks(
  picks: readonly PreviewPick[],
  candidates: readonly Cand[],
  sessionDate: string | null | undefined,
  official: boolean,
): { activePicks: PreviewPick[]; archivedPicks: PreviewArchiveRow[] } {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const activePicks: PreviewPick[] = [];
  const archivedPicks: PreviewArchiveRow[] = [];

  for (const pick of picks) {
    const candidate = byId.get(pick.candidateId);
    let reason: string | null = null;

    if (!validMarketDate(sessionDate) || isTradingDay(sessionDate, "SE") !== true) {
      reason = "Sessionsdatum saknas, är ogiltigt eller är inte en verifierad svensk handelsdag.";
    } else if (!candidate) {
      reason = "Kandidatunderlag saknas.";
    } else if (pick.market !== "SE" || candidate.market !== "SE") {
      reason = "Ej verifierad svensk OMXS30-kandidat.";
    } else {
      const identity = [{ ticker: candidate.ticker, market: pick.market }];
      const activeIdentity = filterActiveOmxs30Picks(identity, sessionDate);
      if (!activeIdentity.length) {
        const archivedIdentity = filterArchivedOmxs30Picks(identity, sessionDate);
        reason = archivedIdentity.length
          ? "Utanför OMXS30 på sessionsdatumet eller före aktivt OMXS30-scope."
          : "OMXS30-medlemskap kunde inte verifieras.";
      }
    }
    if (!reason && candidate && !candidate.dataQuality?.dataAsOf) {
      reason = "Verifierat marknadsdatadatum saknas.";
    }
    if (!reason && candidate?.dataQuality?.dataAsOf && validMarketDate(sessionDate)) {
      const freshness = d1Freshness(candidate.dataQuality.dataAsOf, sessionDate, "SE");
      if (freshness.status !== "CURRENT") {
        reason = freshness.status === "STALE"
          ? `Marknadsdata är stale (${candidate.dataQuality.dataAsOf}); förväntad D−1-dag är ${freshness.expected ?? "okänd"}.`
          : freshness.status === "CONFLICT"
            ? `Marknadsdatumet ${candidate.dataQuality.dataAsOf} ligger efter förväntad D−1-dag ${freshness.expected ?? "okänd"}.`
            : "D−1-marknadsdatum kunde inte verifieras.";
      } else {
        const decision = official
          ? candidate.officialSelection?.decision ?? candidate.decision
          : candidate.decision;
        if (["STALE", "CONFLICT", "INVALID"].includes(decision?.status ?? "")) {
          reason = `Screeningstatus ${decision?.status} — flyttad från aktiv vy.`;
        }
      }
    }

    if (reason) archivedPicks.push({ pick, candidate, reason });
    else activePicks.push(pick);
  }

  return { activePicks, archivedPicks };
}

export function LiveTop3Preview({
  live, candidates, frozen, sessionId, sessionDate, quotes,
}: {
  live: LiveSelection;
  candidates: Cand[];
  frozen: Frozen;
  sessionId: number;
  sessionDate?: string | null;
  onCutoff: () => void;
  quotes?: Record<string, EntryQuote>;
}) {
  const official = frozen?.available === true;
  const show = live.previewAvailable || official;
  const displayPicks: LiveSelection["picks"] = official
    ? candidates.flatMap((candidate) => {
      const selection = candidate.officialSelection;
      if (!selection?.selected || selection.rank == null ||
        (selection.market !== "SE" && selection.market !== "US") ||
        (selection.source !== "telegram" && selection.source !== "edgeai")) return [];
      return [{
        candidateId: candidate.id, rank: selection.rank, score: selection.score,
        market: selection.market, direction: selection.direction, signalSource: selection.source,
      }];
    })
    : live.picks;
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const { activePicks, archivedPicks } = partitionLiveTop3Picks(
    displayPicks,
    candidates,
    sessionDate,
    official,
  );
  const expectedDataDate = validMarketDate(sessionDate) && isTradingDay(sessionDate, "SE") === true
    ? previousMarketDay(sessionDate, "SE")
    : null;
  const groups = [
    { key: "LONG", label: "OMXS30 · Topp 3 Köp / Long", direction: "LONG" },
    { key: "SHORT", label: "OMXS30 · Topp 3 Sälj / Short", direction: "SHORT" },
  ].map((g) => ({
    ...g,
    picks: activePicks
      .filter((p) => p.direction === g.direction)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 3),
  })).filter((g) => g.picks.length > 0);
  const picks = groups.flatMap((g) => g.picks);

  return (
    <div data-testid="panel-live-top3" className="mb-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 data-testid="text-live-title" className="text-sm font-semibold">
            OMXS30 · {official ? "officiellt Top 3 – fryst urval" : "preliminär Top 3"}
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Session {sessionDate && validMarketDate(sessionDate) ? sessionDate : "ej verifierad"}
            {" · "}förväntad svensk datadag D−1: {expectedDataDate ?? "ej verifierad"}
            {" · "}{official
              ? "Urvalet är sparat. Senare importer ändrar inte dagens officiella picks."
              : "Förhandsvisningen räknas inte i officiell statistik."}
          </p>
        </div>
        {frozen?.available && (
          <div data-testid="text-official-freeze" className="shrink-0 text-xs font-semibold text-primary">
            {frozen?.available
              ? "Officiellt urval fryst"
              : "Inväntar båda källorna"}
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2" data-testid="list-source-receipts">
        {(["telegram", "edgeai"] as const).map((k) => {
          const r = live.sourceReceipts[k];
          const late = r.received && !r.receivedBeforeCutoff;
          return (
            <div key={k} data-testid={`status-source-${k}`} className="rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-xs">
              <div className="flex items-center gap-1 font-semibold">
                {r.received && !late ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                )}
                {NAMES[k]}
              </div>
              <div className="mt-0.5 text-muted-foreground">
                {!r.received
                  ? "Ej mottagen idag"
                  : late
                    ? `Mottagen efter låsning · ${r.candidateCount} kandidater`
                    : `Mottagen idag · ${r.candidateCount} kandidater`}
              </div>
            </div>
          );
        })}
      </div>

      {frozen && (
        <p data-testid="text-frozen-sources" className="mt-2 text-[11px] text-muted-foreground">
          Lagrade källor vid låsning:{" "}
          {frozen.participatingSources
            ? frozen.participatingSources.length ? frozen.participatingSources.join(" + ") : "inga"
            : "ingen utvärdering sparad"}
          {" · krav: "}{frozen.requiredSources.join(" + ")}
          {frozen.available ? "" : " · ännu inte fryst"}
        </p>
      )}

      {show &&
        (picks.length === 0 && archivedPicks.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {official ? "Urvalet är låst, men inga kandidater klarade handelsreglerna." : "Servern har inga preliminära val just nu."}
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            <p data-testid="text-screening-explainer" className="text-[11px] text-muted-foreground">
              Endast svenska OMXS30-medlemmar med verifierat D−1-underlag visas aktivt. Screeningstatus är inte ordergodkännande.
            </p>
            {picks.length === 0 && (
              <p className="text-xs text-muted-foreground">Inga kandidater klarade OMXS30- och D−1-kontrollen för den här sessionen.</p>
            )}
            {groups.map((g) => (
              <div key={g.key} data-testid={`group-live-SE:${g.direction}`}>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</div>
                <ol className="space-y-2">
            {g.picks.map((p) => {
              const c = byId.get(p.candidateId);
              const decision = official
                ? c?.officialSelection?.decision ?? c?.decision
                : c?.decision;
              const liveGuardAllowed = decision?.status === "TRADEABLE" || decision?.status === "WAIT";
              return (
                <li key={p.candidateId} data-testid={`row-live-pick-${p.candidateId}`} className="rounded-lg border border-border px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">#{p.rank}</span>
                    <span className="font-bold">{c ? c.ticker.replace(/\.ST$/i, "") : `Kandidat ${p.candidateId}`}</span>
                    {c?.signalDate && <span className="font-mono text-[11px] text-muted-foreground">{c.signalDate}</span>}
                    <span className="ml-auto"><DecisionBadge decision={decision} /></span>
                  </div>
                  {c && <p className="mt-1 text-[11px] text-muted-foreground">
                    Datadag {c.dataQuality?.dataAsOf ?? "ej verifierad"} · källa {c.dataQuality?.source ?? "okänd"}
                  </p>}
                  {c && <PlanGrid plan={c} caption="Originalplan · D−1-underlag" />}
                  {c && liveGuardAllowed
                    ? <LiveEntryGuard plan={{ ...c, direction: p.direction }}
                      quote={quotes?.[quoteRequestTicker(c.ticker, c.market)]} signal={c} />
                    : <p className="mt-1 rounded-md bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground">
                      Live-entrykontroll visas inte: screeningstatus är inte entryberättigad.
                    </p>}
                  <details className="mt-1 text-[11px] text-muted-foreground">
                    <summary className="cursor-pointer select-none">Visa detaljer</summary>
                    <p className="mt-1">{p.market} · {p.direction === "SHORT" ? "Sälj" : "Köp"} · {NAMES[p.signalSource]} · poäng {p.score.toFixed(2)}</p>
                    {decision && decision.reasons.length > 0 && (
                      <p className="mt-1 leading-relaxed">{decision.reasons.join(" ")}</p>
                    )}
                  </details>
                </li>
              );
            })}
                </ol>
              </div>
            ))}
            {archivedPicks.length > 0 && (
              <details data-testid="details-live-top3-archive" className="rounded-lg border border-border bg-muted/30 p-3">
                <summary className="cursor-pointer text-xs font-semibold">
                  Visa arkiv / ej aktiva picks ({archivedPicks.length})
                </summary>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  Arkivrader behålls för granskning men är inte aktuella OMXS30-förslag. Ingen Live Entry Guard eller entrybekräftelse visas här.
                </p>
                <ul className="mt-2 space-y-2">
                  {archivedPicks.map(({ pick, candidate, reason }) => (
                    <li key={pick.candidateId} data-testid={`row-live-archive-${pick.candidateId}`}
                      className="rounded-md border border-border px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong>{candidate?.ticker.replace(/\.ST$/i, "") ?? `Kandidat ${pick.candidateId}`}</strong>
                        <span>{pick.market} · {pick.direction === "SHORT" ? "Sälj / Short" : "Köp / Long"}</span>
                        {candidate?.signalDate && <span className="font-mono text-muted-foreground">{candidate.signalDate}</span>}
                        <span className="text-amber-700 dark:text-amber-400">ARKIV · ej aktiv signal</span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">{reason}</p>
                      {candidate && <PlanGrid plan={candidate} caption="Historisk originalplan · endast arkiv" />}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
      {!show && (
        <p className="mt-3 text-xs text-muted-foreground">
          {frozen?.unavailableReason ?? "Ingen källa med dagens signaldatum har mottagits ännu."}
        </p>
      )}
      <Link href={`/sessions/${sessionId}`} className="mt-3 inline-flex items-center text-xs text-primary hover:underline">
        Visa alla kandidater <ChevronRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

export function EdgeAiStatusTotals({ candidates }: { candidates: { id: number; ticker: string; decision?: { status: string; reasons: string[] } }[] }) {
  const buckets: Record<"TRADEABLE" | "WAIT" | "BLOCKED", typeof candidates> = { TRADEABLE: [], WAIT: [], BLOCKED: [] };
  for (const c of candidates) {
    const b = (DECISION_TXT[c.decision?.status ?? ""] ?? "WAIT") as keyof typeof buckets;
    buckets[b].push(c);
  }
  return (
    <div data-testid="list-edgeai-status-totals" className="mt-3 flex flex-wrap gap-2 text-xs">
      {(["TRADEABLE", "WAIT", "BLOCKED"] as const).map((k) => {
        const raw = [...new Set(buckets[k].map((c) => c.decision?.status ?? "okänd"))].filter((r) => r !== k);
        return (
          <span
            key={k}
            data-testid={`text-edgeai-total-${k}`}
            title={raw.length ? `Inkluderar: ${raw.join(", ")}` : undefined}
            className={`rounded border px-2 py-1 font-semibold ${DECISION_CLS[k]}`}
          >
            {k} {buckets[k].length}
            {raw.length > 0 && <span className="ml-1 font-normal opacity-80">({raw.join(", ")})</span>}
          </span>
        );
      })}
    </div>
  );
}
