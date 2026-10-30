# AG Invest – oberoende kvalitetsrevision, 30 oktober 2026

## Syfte och begränsning
Denna granskning gäller kod i GitHub-repositoriet **omxsscreener**, plus EdgeAI:s och OMXS30-screenerns publicerade metod. Den är **inte** ett bevis på att samma kod är driftsatt i Replit. Ingen orderhandel får initieras av denna kod.

## Genomförda ändringar i denna pull request
- Ta bort den felaktiga formuleringen att signaler är **sorterade efter sannolikhet**. Det finns ingen kalibrerad prediktiv sannolikhetsmodell.
- Rangordna forskningskandidater med **evidensnivå först**, därefter historiskt **E[R]**. Vinstfrekvens visas separat; den multipliceras inte med E[R].
- Visa tydlig varning när det finns **noll kvalificerade EdgeAI-signaler**. Även en passerad prisnivå ska vara en bevakning, inte en grön handelsorder.
- Okänd/äldre kandidatproveniens får inte automatiskt tolkas som verifierad EdgeAI-data.
- Beskriv överlapp i signalkategorier som just överlapp; appen har inte beräknat verklig statistisk kurskorrelation.
- Top3-analysens svar markerar sin metod som **EXPLORATORY_RESEARCH_ONLY**.
- Aktiepriser, entry, stop, mål och R/R märks nu uttryckligen som **underliggande** i kandidattabellen och sessionsvyn.

## Fortsatta blockerare före beslutssystem/produktion

### P0 – korrekt datamodell och versionsspårbarhet
- `edgeai.ts` och schemalagd import återanvänder `rsi`, `perf1m`, `pctB`, `volMultiplier` och `distFrom20dH` för helt andra EdgeAI-mått.
- En egen schemalagd migration ska lägga till tydliga kolumner för `expectedR`, `winRate`, `sampleN`, `barsAgo`, `evidenceStatus`, `sourceDataAsOf`, `modelVersion` och verklig `signalDate`.
- Avvakta databasändring tills befintlig Replit/Postgres och produktionsbackup verifierats; migrera gamla rader med källhänvisning, inte gissningar.

### P0 – säkra datakällor och avsikter
- `generatedAt` beskriver när filen skapats, inte kursseriens handelsdag. Både SE- och US-`dataAsOf` måste visas och kontrolleras; stale/konflikt måste stänga av nya handelsförslag.
- `EdgeAI`-setups är **WATCH** och får inte misstas för godkända affärer; `OMXS30`-screenerns Oraklet-kvalitet registreras för närvarande inte som en egen strukturerad kategori i parsern.
- Rapportsidan bör kontrollera tidpunkt (före/efter USA-stängning) och verifierad källa för rapportdatum och kursreaktioner.

### Beslutad avgränsning – enbart underliggande aktier
- Asset Screen analyserar och visar **underliggande aktier**: kurs, trend, relativ styrka, signalens ursprung, entry, stop loss, mål och R/R räknat på själva aktien.
- Appen ska **inte** välja, värdera, modellera eller föreslå mini futures, turbos, warranter, hävstång, knockout eller instrumentorder.
- AG Invest/styrelsen och kontoägaren ansvarar **utanför Asset Screen** för derivatval, faktisk positionsstorlek, spread, knockout, hävstång och alla handelsbeslut.
- Aktie-stop på skärmen är **inte** en garanterad stop i ett derivat. Detta ska stå tydligt i UI.
- Asset Screen behåller forskningslogg och uppföljning av **underliggande aktiesignaler**. Det är inte samma sak som en journal över Avanzas faktiska derivathandel.

### Separat AG Invest-revision (utanför Asset Screen)
- Stäm av Avanzas faktiska transaktioner, insättningar, uttag, affärsbeslut och portföljrisk separat, och håll kontodata borta från publika GitHub.
- Rekonstruera historiken 11 000 → 22 000 → 10 000 kr utan att blanda in derivatexekvering i aktiescreenern.
- Den tidigare föreslagna derivatriskmotorn och Avanza-integrationen är **inte längre planerade funktioner i Asset Screen**.

### P1 – framåtblickande validering
- Frys modellversion och publicera alltid även *underkända* signaler och tomma dagar. Byt inte historiska signalnivåer efter kursutfall.
- Jämför underliggande aktiesignaler med passiva index och enkla trendregler. Derivatutfall analyseras separat inom AG Invest.
- EdgeAI:s offentliggjorda ledger per 30 oktober 2026: USA 127 stängda modellaffärer, -43,38R; Sverige 39, +5,21R. Dessa är **inte** Avanzas verkliga P&L eller statistiskt bekräftad avkastningsfördel.
- 0 / 155 aktuella EdgeAI-förslag kvalificerar enligt den striktaste out-of-sample-gaten.

## Krav före merge och release
1. GitHub PR-CI: komplett typkontroll och produktionsbygge ska passera för exakt PR-commit.
2. Granska att frontend visar rätt proveniens och att ingen ”sannolikhet” eller grön autotradeindikator återstår.
3. Kontrollera aktuell Replit-kod och databas/migrationer före sammanslagning.
4. Ingen automatisk publicering. Publicera bara efter separat verifiering av aktuell app, mobilvy, datakvalitet, STALE/CONFLICT och ingen regression.
