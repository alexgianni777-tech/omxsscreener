import { Link } from "wouter";
import type { Top3Revision } from "@workspace/api-client-react";
import { DecisionBadge } from "./LiveTop3Preview";

function timestamp(value: string) {
  return new Date(value).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" });
}

function Picks({ revision }: { revision: Top3Revision }) {
  return (
    <div className="space-y-3">
      {(["SE", "US"] as const).flatMap((market) => (["LONG", "SHORT"] as const).map((direction) => {
        const picks = revision.picks.filter((pick) => pick.market === market && pick.direction === direction)
          .sort((a, b) => a.rank - b.rank);
        if (!picks.length) return null;
        return (
          <section key={`${market}:${direction}`} data-testid={`revision-group-${market}-${direction}`}>
            <h4 className="mb-1 text-xs font-semibold">{market === "SE" ? "Sverige" : "USA"} · Topp 3 {direction === "SHORT" ? "Sälj" : "Köp"}</h4>
            <ol className="space-y-2">
              {picks.map((pick) => (
                <li key={pick.candidateId} data-testid={`revision-pick-${pick.candidateId}`} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono text-xs">#{pick.rank}</span>
                    <strong>{pick.ticker.replace(/\.ST$/i, "")}</strong>
                    <span className="text-xs text-muted-foreground">{pick.source === "telegram" ? "Telegram" : "EdgeAI"}</span>
                    {pick.signalDate && <span className="text-xs text-muted-foreground">Rapport {pick.signalDate}</span>}
                    <DecisionBadge decision={pick.decision} />
                  </div>
                  <p className="mt-1 font-mono text-xs">Entry {pick.entryPrice} · Stop {pick.stopPrice} · Mål {pick.targetPrice} · R/R {pick.rr}</p>
                  {pick.decision.reasons.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{pick.decision.reasons.join(" ")}</p>}
                </li>
              ))}
            </ol>
          </section>
        );
      }))}
    </div>
  );
}

/** Uses revision prices, not the older candidate plan belonging to a logged trade. */
export function CurrentTop3Selection({ revisions, sessionId }: { revisions: Top3Revision[]; sessionId: number }) {
  if (!revisions.length) return null;
  const [current, ...history] = [...revisions].sort((a, b) => b.revision - a.revision);
  return (
    <div data-testid="panel-current-top3" className="mb-4 rounded-xl border border-primary/25 bg-card p-4 shadow-sm">
      <h3 data-testid="text-current-top3-title" className="font-semibold">Aktuell Top 3 · version {current.revision}</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Uppdaterad {timestamp(current.selectedAt)} · Källor: {current.sources.join(" + ") || "saknas"}.
        Nya importer med ändrad signaldata räknar om förslagen. Registrerade trades och ursprunglig statistik skrivs inte om.
      </p>
      <div className="mt-3">
        {!current.available
          ? <p className="text-sm text-amber-600">Inväntar Telegram och EdgeAI för dagens session. Föregående handelsdags rapporter accepteras.</p>
          : current.picks.length === 0
            ? <p className="text-sm text-muted-foreground">Inga kandidater klarar handelsreglerna i den senaste datan.</p>
            : <Picks revision={current} />}
      </div>
      {history.length > 0 && (
        <details data-testid="revision-history" className="mt-4 border-t border-border pt-3">
          <summary className="cursor-pointer text-sm font-medium">Tidigare urval ({history.length} versioner)</summary>
          <div className="mt-3 space-y-4">
            {history.map((revision) => (
              <details key={revision.revision} data-testid={`history-version-${revision.revision}`}>
                <summary className="cursor-pointer text-xs font-semibold">
                  Version {revision.revision} · {timestamp(revision.selectedAt)} · {revision.picks.length} förslag
                </summary>
                <div className="mt-2">
                  {revision.available ? <Picks revision={revision} /> : <p className="text-xs text-muted-foreground">Båda källorna fanns inte ännu.</p>}
                </div>
              </details>
            ))}
          </div>
        </details>
      )}
      <Link href={`/sessions/${sessionId}`} className="mt-3 inline-block text-xs text-primary hover:underline">Alla kandidater och tradehistorik</Link>
    </div>
  );
}