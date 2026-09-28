import { TOP3_POLICY_VERSION, TOP3_REQUIRED_SOURCES, top3CutoffForDate } from "./top3SelectionPolicyCore";

type SessionSnapshotState = {
  date: string;
  top3SnapshotAt: Date | null;
  top3PolicyVersion: string | null;
  top3CutoffAt: Date | null;
  top3CutoffEvaluatedAt: Date | null;
  top3ParticipatingSources: string[] | null;
};

const STOCKHOLM_DATE = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit",
});

export function describeTop3Snapshot(session: SessionSnapshotState, now = new Date()) {
  const available = session.top3SnapshotAt != null;
  const today = STOCKHOLM_DATE.format(now);
  const requiredSources = (session.top3PolicyVersion === TOP3_POLICY_VERSION || session.date === today)
    ? [...TOP3_REQUIRED_SOURCES]
    : [];
  const cutoffAt = session.top3CutoffAt ?? (session.date === today ? top3CutoffForDate(today) : null);
  const participatingSources = session.top3ParticipatingSources ?? null;
  const missing = TOP3_REQUIRED_SOURCES.filter((source) => !participatingSources?.includes(source));

  let state: "AVAILABLE" | "WAITING_FOR_CUTOFF" | "EVALUATING" | "MISSING_SOURCES" | "LEGACY_UNAVAILABLE";
  let unavailableReason: string | null;
  if (available) {
    state = "AVAILABLE";
    unavailableReason = null;
  } else if (session.top3CutoffEvaluatedAt) {
    state = "MISSING_SOURCES";
    unavailableReason = `Vid 16:30 saknades dagens ${missing.join(" och ") || "verifierade källor"}; inget officiellt urval för sessionen.`;
  } else if (session.date === today && cutoffAt && now < cutoffAt) {
    state = "WAITING_FOR_CUTOFF";
    unavailableReason = "Officiellt Top 3 fryses kl. 16:30 svensk tid om både dagens Telegram-lista och EdgeAI-import finns.";
  } else if (session.date === today) {
    state = "EVALUATING";
    unavailableReason = "16:30 har passerat; väntar på schemalagd utvärdering av dagens båda källor.";
  } else {
    state = "LEGACY_UNAVAILABLE";
    unavailableReason = "Ingen verifierad samtida Top 3-snapshot finns för denna äldre session.";
  }

  return {
    available,
    state,
    unavailableReason,
    selectedAt: session.top3SnapshotAt,
    policyVersion: session.top3PolicyVersion,
    cutoffAt,
    evaluatedAt: session.top3CutoffEvaluatedAt,
    participatingSources,
    requiredSources,
  };
}