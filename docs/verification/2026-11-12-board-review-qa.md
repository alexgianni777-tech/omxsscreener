# Avgränsad slutkontroll 2026-11-12

## Kod och ändring

Kontrollen utgick från `36ede21` på `feature/asset-screen-2-0`.
API-koden ändrades inte under denna omgång.

Ett faktiskt visningsfel upptäcktes och rättades:
sessionskortets allmänna WARN-orsak dolde kandidatens redan korrekt avgränsade
källkonflikt. `LiveEntryGuard` får nu en uttrycklig `sourceConflict`-flagga från
API:ts exakt matchade `candidate.importWarning`. Den prioriterar den konflikten,
visar en kompakt `CONFLICT – BLOCKERAD, ingen ny entry`-rad även utan kurs och
visar originalvarningen en gång i detaljerna. Ingen textmatchning används för
att välja aktie. Andra kort får inte konfliktflaggan.

Ändrade produktfiler:
- `artifacts/screener/src/components/LiveEntryGuard.tsx`
- `artifacts/screener/src/pages/session-detail.tsx`
- `artifacts/screener/src/lib/liveEntryGuardView.test.ts`

Ingen strategi, numerisk handelsplan, ranking, import eller SQL-migrering ändrades.

## Automatiska kontroller på slutkoden

- Frontend: **46/46**, 0 fel i de berörda regressionstesterna.
- Backend: **65/65**, 0 fel: tidigare 61 scenarier samt 4 isoleringstester.
- TypeScript: frontend och backend godkända.
- Produktionsbyggen: frontend och backend godkända.
- Frontendbygget varnade för en JS-del över 500 kB; inte ett byggfel.

Backendfiler: `tradePerformance`, `tradeJournal`, `edgeAiMapping`,
`quoteEarningsDate`, `sourceMarketContext`, `stabilityV2`, `screeningReview`,
`signalDataSanity`, `sharedResearchPolicy`, `e2eTestSafety` (`.test.ts`).
Frontendfiler: `assetScreenV2`, `portfolioRisk`, `journalAnalysis`,
`ResearchWarnings`, `SwedishResearch`, `liveEntryGuardView`,
`quoteMarketIdentity`, `RiskPanel`, `boardReview` (`.test.ts`).
Detta var riktade regressioner, inte samtliga tester i hela kodbasen.

## Faktiskt renderad, inloggad UI

En verklig separat lokal PostgreSQL, API-serverns byggda kod och en tillfällig
admin-session användes. Inga auth-/API-svar ersattes med browsermockar.
Allt finansiellt testunderlag var syntetiskt och märkt DEMO.

- Mobil 402×874: Sverige/USA och long/short, planfält, datum, max hålltid,
  saknad livekurs och manuell styrelsegrind kontrollerades.
- Desktop 1280×900: översikt, sida-vid-sida-kort och historik läsbara utan
  överlappande planvärden.
- Datakvalificerad SCA-B hade APPROVED/WAIT i API och ingen exekverbar READY i UI.
  MSFT mot marknadsregim och SSAB-B förblev WARN/WAIT.
- Alla fem granskningsfält började tomma. DEMO-anteckningar gav inget automatiskt
  godkännande. Faktisk exporterad text-Blob innehöll fem roller, originalplan,
  BOARD REVIEW REQUIRED och uttrycklig text om ej verifierat ordergodkännande.
- Historisk NIBE-B visade STALE, originalplan och antaget, ej loggat utfall.
  Detta räknades inte som en faktisk fill.
- Efter visningsfixen verifierades ERIC-B:s konflikt på nytt i mobilvyn,
  inklusive en enda originalvarning; SCA-B saknade den konflikten.
- Ingen dokumentöverbredd i kontrollerade mobilvyer. Historiklistan hade viss
  intern horisontell scroll; inte ett säkerhets-/publiceringsfel.

## Isolering och avslut

E2E_TEST avvisade en otillåten DB-adress med exit 1 före start.
Schemaläggare/wake var avstängda i QA-API:t och extern nättrafik spärrad.
Webbläsarens API-trafik gick endast till QA-proxyn.
Inga muterande HTTP-anrop förekom. Testkandidaternas fullständiga rader hade
identiskt kontrollvärde före/efter: planer och utfall oförändrade.

En felaktig handbyggd testfixtur rättades före UI-testet för obligatoriska
kvittofält. Historikfixturens importtider korrigerades också: en gammal rapport
som seedas sist med dagens importtid blir annars rätteligen senaste kvitto.
Detta krävde ingen ändring av produktionslogik.

Den tillfälliga webbharnessen/proxyn togs bort och API/test-PostgreSQL stoppades.
Ordinarie API-workflow startades inte om. QA använde inte produktionsdatabasen.

## Bedömning och ej verifierat

Tekniskt GO för manuell publicering inom denna avgränsade kontroll.
Ingen publicering utförd. Inga nya SQL-schemaändringar i denna omgång.

Detta verifierar inte skarp OIDC-inloggning, aktuell Yahoo-kurs, GitHub-hämtning,
Telegram-leverans, produktionsdatabasens eventuella äldre schemaavvikelser eller
lönsamhet. Ett fryst äldre urval utan bevarad kvalitetsproveniens ska fortsatt
vara okänt/blockerat; senare kandidatdata används inte för att uppgradera det.
