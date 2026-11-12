import { useEffect, useRef } from "react";
import {
  deriveTodayDiagnostics,
  type DiagnosticFrozenSelection,
  type DiagnosticLiveSelection,
  type TodayDiagnosticCandidate,
} from "../lib/todayDiagnostics";

const SOURCE_NAMES: Record<string, string> = {
  edgeai: "EdgeAI",
  telegram: "Telegram",
};

function selectedText(
  available: boolean,
  counts: Record<string, number> | null,
  source: string,
  market: string,
  direction: string,
) {
  if (!available || !counts) return "ej tillgängligt";
  return String(counts[`${source}:${market}:${direction}`] ?? 0);
}

export function TodayDiagnostics({
  sessionDate,
  today,
  candidates,
  live,
  frozen,
}: {
  sessionDate: string;
  today: string;
  candidates: TodayDiagnosticCandidate[];
  live?: DiagnosticLiveSelection | null;
  frozen?: DiagnosticFrozenSelection;
}) {
  const diagnostics = deriveTodayDiagnostics({
    sessionDate,
    today,
    candidates,
    live,
    frozen,
    now: Date.now(),
  });
  const loggedIssues = useRef(new Set<string>());

  useEffect(() => {
    for (const issue of diagnostics?.issues ?? []) {
      if (loggedIssues.current.has(issue.issueId)) continue;
      loggedIssues.current.add(issue.issueId);
      console.error("Short selection inconsistency", issue);
    }
  }, [diagnostics]);

  if (!diagnostics) return null;

  return (
    <section
      data-testid="panel-today-diagnostics"
      aria-label="Dagens import- och urvalsdiagnostik"
      className="mb-3 rounded-xl border border-border bg-card p-4 shadow-sm"
    >
      <div>
        <h3 className="text-sm font-semibold">Dagens import- och urvalsdiagnostik</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Dagens Stockholm-session accepterar även föregående handelsdags rapporter. Rapportdatum behålls; övriga handelsregler gäller fortfarande.
        </p>
      </div>

      <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
        {diagnostics.sourceState === "none" ? (
          <p data-testid="status-diagnostics-no-source" className="font-medium">
            Ingen verifierad EdgeAI- eller Telegram-rapport från idag eller föregående handelsdag finns i dagens session.
          </p>
        ) : diagnostics.sourceState === "unavailable" ? (
          <p>Källstatus ej tillgänglig.</p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {diagnostics.sourceReceipts.map((receipt) => (
              <span key={receipt.source} data-testid={`status-diagnostics-source-${receipt.source}`}>
                <span className="font-medium">{SOURCE_NAMES[receipt.source]}:</span>{" "}
                {receipt.received
                  ? `mottagen${receipt.candidateCount == null ? "" : ` · ${receipt.candidateCount} kandidater`}`
                  : "ingen källa mottagen"}
                {receipt.received && receipt.signalDates.length > 0 && (
                  <span className="text-muted-foreground"> · rapport {receipt.signalDates.join(", ")}{receipt.signalDates.some((date) => date !== sessionDate) ? " · en handelsdags fördröjning accepterad" : ""}</span>
                )}
              </span>
            ))}
          </div>
        )}
        {diagnostics.shortImported === 0 ? (
          <p data-testid="status-no-short-imported" className="mt-1">
            Inga SHORT-signaler importerade från EdgeAI eller Telegram.
          </p>
        ) : diagnostics.tradeableShort === 0 ? (
          <p data-testid="status-no-tradeable-short" className="mt-1">
            SHORT-signaler finns ({diagnostics.shortImported}), men ingen har aktuell TRADEABLE-status.
          </p>
        ) : (
          <p className="mt-1">
            TRADEABLE SHORT: {diagnostics.tradeableShort} av {diagnostics.shortImported} importerade.
          </p>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {diagnostics.groups.map((group) => (
          <div
            key={`${group.source}:${group.market}`}
            data-testid={`card-diagnostics-${group.source}-${group.market}`}
            className="rounded-lg border border-border px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold">{SOURCE_NAMES[group.source]} · {group.market}</span>
              <span className="font-mono text-muted-foreground">{group.total} importerade</span>
            </div>
            <div className="mt-2 space-y-1.5">
              {(["LONG", "SHORT"] as const).map((direction) => {
                const totals = group[direction];
                return (
                  <div key={direction} className="rounded-md bg-muted/40 px-2 py-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px]">
                      <span className="font-semibold">{direction} · {totals.total}</span>
                      <span className="text-muted-foreground">
                        TRADEABLE {totals.tradeable} · WAIT {totals.wait} · BLOCKED {totals.blocked}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
                      <span>
                        Val prelim. {selectedText(
                          diagnostics.preliminary.available,
                          diagnostics.preliminary.selectedCounts,
                          group.source,
                          group.market,
                          direction,
                        )}
                      </span>
                      <span>
                        Officiellt {selectedText(
                          diagnostics.official.available,
                          diagnostics.official.selectedCounts,
                          group.source,
                          group.market,
                          direction,
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Råstatus: INVALID {group.raw.invalid} · STALE {group.raw.stale} · CONFLICT {group.raw.conflict}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div data-testid="status-preliminary-selection" className="rounded-lg border border-border px-3 py-2 text-xs">
          <p className="font-semibold">Preliminärt urval</p>
          <p className={diagnostics.preliminary.available ? "text-muted-foreground" : "text-amber-600"}>
            {diagnostics.preliminary.available
              ? "Tillgängligt före bryttiden."
              : diagnostics.preliminary.reason}
          </p>
        </div>
        <div data-testid="status-official-selection" className="rounded-lg border border-border px-3 py-2 text-xs">
          <p className="font-semibold">Officiellt fryst urval</p>
          <p className={diagnostics.official.available ? "text-muted-foreground" : "text-amber-600"}>
            {diagnostics.official.available
              ? "Tillgängligt från den frysta snapshoten."
              : diagnostics.official.reason}
          </p>
        </div>
      </div>

      {(diagnostics.outsideMainCounts.length > 0 || diagnostics.outsideSelectedCounts.length > 0) && (
        <div data-testid="list-diagnostics-outside-counts" className="mt-3 rounded-lg border border-border px-3 py-2 text-xs">
          <p className="font-semibold">Utanför EdgeAI/Telegram · SE/US-räkningen</p>
          <p className="mt-1 text-muted-foreground">
            Manuella och andra/okända källor samt okänd marknad visas här, inte i huvudräkningen.
          </p>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
            {diagnostics.outsideMainCounts.map((item) => (
              <li key={`${item.source}:${item.market}`}>
                {item.source} · {item.market}: {item.count}
              </li>
            ))}
          </ul>
          {diagnostics.outsideSelectedCounts.length > 0 && (
            <ul className="mt-2 space-y-1 border-t border-border pt-2 text-muted-foreground">
              {diagnostics.outsideSelectedCounts.map((item) => (
                <li key={`${item.source}:${item.market}:${item.direction}`}>
                  Val utanför huvudräkningen · {item.source} · {item.market} · {item.direction}: prelim.{" "}
                  {item.preliminary ?? "ej tillgängligt"} · officiellt {item.official ?? "ej tillgängligt"}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {diagnostics.topShortBlockingReasons.length > 0 && (
        <div data-testid="list-diagnostics-short-blocking-reasons" className="mt-3 rounded-lg border border-border px-3 py-2 text-xs">
          <p className="font-semibold">Vanligaste blockeringsorsaker · SHORT</p>
          <ul className="mt-1 space-y-1 text-muted-foreground">
            {diagnostics.topShortBlockingReasons.map((item) => (
              <li key={item.reason} className="flex justify-between gap-3">
                <span>{item.reason}</span>
                <span className="shrink-0 font-mono">{item.candidateCount} kandidater</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {diagnostics.issues.map((issue) => (
        <div
          key={issue.issueId}
          data-testid={`status-short-selection-inconsistency-${issue.mode}-${issue.market}`}
          role="alert"
          className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <p className="font-semibold">Short selection inconsistency</p>
          <p className="mt-0.5">
            {issue.market}: {issue.eligibleShortCount} valbar TRADEABLE SHORT-kandidat, men inget SHORT-val i urvalet
            {issue.eligibleSources.length ? ` (${issue.eligibleSources.join(", ")})` : ""}.
          </p>
        </div>
      ))}
    </section>
  );
}