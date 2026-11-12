/**
 * Conservative maintenance, never an import/selection rule.
 * A candidate referenced anywhere in immutable evidence remains protected.
 */
export const UNUSED_CANDIDATE_RETENTION_DAYS = 3;
export const UNUSED_CANDIDATE_WHERE = `
  c.created_at < CURRENT_TIMESTAMP - INTERVAL '3 days'
  AND s.date < (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Stockholm')::date - 3
  AND c.outcome = 'PENDING'
  AND COALESCE(c.is_top3_pick, false) = false
  AND c.exit_price IS NULL AND c.realized_r IS NULL
  AND NULLIF(TRIM(c.outcome_notes), '') IS NULL
  AND c.resolution_method IS NULL AND c.resolution_quality IS NULL
  AND c.resolution_entry_price IS NULL AND c.resolution_stop_price IS NULL
  AND c.resolution_direction IS NULL
  AND c.session_id <> (
    SELECT newest.session_id
    FROM candidates newest JOIN screener_sessions ns ON ns.id = newest.session_id
    WHERE COALESCE(newest.market, 'SE') = COALESCE(c.market, 'SE')
      AND COALESCE(newest.signal_source, newest.origin, ns.source, 'legacy')
        = COALESCE(c.signal_source, c.origin, s.source, 'legacy')
    ORDER BY ns.date DESC, newest.created_at DESC, newest.id DESC LIMIT 1
  )
  AND NOT EXISTS (
    SELECT 1 FROM top3_selection_snapshots snap WHERE snap.candidate_id = c.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM top3_selection_revisions rev
    WHERE jsonb_path_exists(
      jsonb_build_array(rev.selections, rev.inputs),
      '$.**.candidateId ? (@ == $id || @ == $textId)',
      jsonb_build_object('id', c.id, 'textId', c.id::text)
    ) OR jsonb_path_exists(
      jsonb_build_array(rev.selections, rev.inputs),
      '$.**.id ? (@ == $id || @ == $textId)',
      jsonb_build_object('id', c.id, 'textId', c.id::text)
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM trade_journal j WHERE jsonb_path_exists(
      j.payload, '$.**.candidateId ? (@ == $id || @ == $textId)',
      jsonb_build_object('id', c.id, 'textId', c.id::text)
    ) OR NOT jsonb_path_exists(j.payload, '$.**.candidateId')
  )
  AND NOT EXISTS (
    SELECT 1 FROM survival_trades trade
    WHERE trade.source_candidate_id = c.id OR trade.source_candidate_id IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM open_positions position
    WHERE position.underlying_ticker IS NULL AND position.instrument IS NOT NULL
      OR regexp_replace(regexp_replace(UPPER(position.ticker), '\\.ST$', ''), '[^A-Z0-9]', '', 'g')
        = regexp_replace(regexp_replace(UPPER(c.ticker), '\\.ST$', ''), '[^A-Z0-9]', '', 'g')
      OR regexp_replace(regexp_replace(UPPER(position.underlying_ticker), '\\.ST$', ''), '[^A-Z0-9]', '', 'g')
        = regexp_replace(regexp_replace(UPPER(c.ticker), '\\.ST$', ''), '[^A-Z0-9]', '', 'g')
  )
`;

export const DELETE_UNUSED_CANDIDATES_SQL = `
  DELETE FROM candidates c USING screener_sessions s
  WHERE s.id = c.session_id AND ${UNUSED_CANDIDATE_WHERE}
  RETURNING c.id
`;

export function developmentCleanupEnabled(environment: string | undefined) {
  return environment === "development";
}
