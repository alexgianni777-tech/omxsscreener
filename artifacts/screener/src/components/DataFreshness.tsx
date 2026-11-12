import React from "react";
import { calendarAge } from "../lib/entrySafety";
import { stockholmToday } from "../lib/persistentTop3Display";
export function DataFreshness({ reportDate, dataDate, source, receiptVerified = false, manual = false, event = false, today = stockholmToday() }: {
  reportDate?: string | null; dataDate?: string | null; source?: string | null;
  receiptVerified?: boolean; manual?: boolean; event?: boolean; today?: string;
}) {
  const age = (date?: string | null) => {
    const days = calendarAge(date, today);
    return days == null ? "ålder okänd" : days < 0
      ? event ? `om ${Math.abs(days)} kalenderdagar` : "framtida datum — verifiera"
      : `${days} kalenderdagar gammalt`;
  };
  return <div className="mt-1 text-xs text-muted-foreground break-words" data-testid="data-freshness">
    <p>{event ? "Manuellt bevakningsdatum" : "Rapportdatum"} {reportDate ?? "okänt"} · {age(reportDate)}
      {!event && <> · marknads-/datadag {dataDate ?? "okänd"} · {age(dataDate)}</>}</p>
    <p>Källa {source ?? "okänd"} · {manual ? "manuellt uppgivet, ej externt verifierat" : receiptVerified
      ? "entydigt lyckat importkvitto; inte extern bekräftelse av rapportkalendern"
      : "källa/datum saknar entydigt verifierat importkvitto"}.
      {!event && " Kalenderålder är inte handelsdagar; D−1/prev close och befintligt helgdagsfilter ändras inte."}</p>
  </div>;
}
