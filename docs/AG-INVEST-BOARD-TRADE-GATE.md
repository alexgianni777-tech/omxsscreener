# AG Invest — obligatoriskt styrelsebeslut före varje ny trade
Gäller från 2026-11-12. En tradingidé kan vara tekniskt **QUALIFIED** utan att vara **GODKÄND FÖR ORDER**. Appen analyserar underliggande aktier, inte Avanza-derivat, och har aldrig rätt att lägga en order.

## 1. Fem uttryckliga utlåtanden i chatten — alla krävs
Detta är fem analytiska roller i en simulerad styrelse, inte verkliga oberoende rådgivare eller digitala signaturer. Utlåtanden måste dokumenteras som explicita JA/NEJ efter granskning, inte förifyllas av screenern eller härledas från poäng.

| Roll | Ansvar | Krävd prövning |
|---|---|---|
| Atlas Sterling | Strategi | Grundtes, trend, varför caset är bättre än alternativen |
| Eleanor | Risk | 20 % maximalt investerat per position och 4 % maximalt planerat portföljrisk-tak; gap/knockout |
| Victor | Datakvalitet | Ticker/marknad/aktieslag, datadag, källa, indikatorer, rapportdatum och verifierbarhet |
| Harper Stern | Marknad | Marknadsregim, katalysator, motargument, koncentration, risk för squeeze |
| Eric Tao | Exekvering | Entry, aktiestop, mål, tidsstopp, spread/courtage, faktisk produktkontroll, FOMO |

**Ingen order enligt processen om en roll säger NEJ, om en uppgift saknas eller om ett utlåtande inte uttryckligen har avgivits.** Då är status **BOARD_REVIEW_REQUIRED** eller **VETO**, aldrig **APPROVED**. Manuell efterhandsregistrering av en redan utförd trade är en avvikelse, inte retroaktivt godkännande.

## 2. Obligatoriska fält
- Unik idé och tidsstämpel, underliggande bolag, ticker, land, aktieslag och källa/datagång.
- Long/short, entry-trigger, invalidation/stop på *underliggande aktie*, mål och maximal innehavstid.
- Rapporter och kommande rapportdatum kontrolleras MANUELLT av styrelsen före order. Automatisk rapport-/kalenderdata får aldrig vara kvalificeringskrav i Asset Screen. Logga att kontrollen är genomförd, källa och eventuella risker; okänd automatisk uppgift ger MANUAL_REPORT_CHECK, inte teknisk BLOCKED-status.
- ATR/volym/relativ styrka/regim. Ogiltig eller gammal data => BLOCKED.
- Föreslagen insats i SEK, procent av aktuell total portfölj och aktiva positioner.
- Risk i SEK vid korrekt stopp samt % av konto, inklusive korrelation. Felvänd stop => INVALID_STOP, **aldrig noll risk**.
- Aktuell faktisk produkt, riktning, spread, hävstång, knockout, finansieringskostnad, courtage, valuta, eventuell valutaomräkning och nettoberäknad R/R. Finns inte dessa => **NET_RR_NOT_VERIFIED**, inget påstått exakt netto-R/R.
- FOMO-/impulskontroll med ja/nej, samt särskild motivering om strategin bryter mot marknadsregimen.
- Fem uttalade styrelseutlåtanden med motiveringar, samt slutstatus och manuell journalreferens.

## 3. Hårda avgränsningar
- Screener QUALIFIED = endast **kandidat**, aldrig godkänd order. Ställ aldrig status READY som kan misstas för genomförd styrelseprövning.
- Max fem positioner i ordinarie portfölj, och utred byte före eventuell sjätte; 20 % kapital per position är inte samma sak som 4 % risk.
- 4 % av totalkapital är absolut högsta *planerade* stop-risk, inte förväntad maximal förlust; gap och knockout kan ge större förlust. Lägre testnivå (0,5–1 %) tills positiv validerad expectancy.
- Saknad finansiell/rapportdata är DATA_MISSING och får aldrig anges som positivt verifierat rapportutfall; den ska inte sänka en teknisk screenerkandidats status/score. Styrelsens manuella rapportkontroll måste dokumenteras innan order enligt vår process.
- Studs och Svagast är RESEARCH tills oberoende nettoresultat motiverar statusändring.
- Bevara skillnaden mellan REAL, SIMULATED och NOT_TAKEN i journal/analys.
- Ändra aldrig verifierad signalhistoria retroaktivt när nya data anländer.
- Ingen autoorder och ingen koppling som kan skapa/ändra Avanza-order.

## 4. Minsta acceptanstester för appen
1. Kandidat med fem saknade styrelseutlåtanden förblir BOARD_REVIEW_REQUIRED även när alla tekniska villkor är QUALIFIED.
2. Om en av fem roller anger NEJ blir status VETO även om fyra anger JA.
3. Long entry 100, stop 110 och short entry 100, stop 90 ger INVALID_STOP, inte 0 risk eller godkännande.
4. Okänd rapportdag => MANUAL_REPORT_CHECK utan att blockera teknisk QUALIFIED; okänd eller för gammal kursdatadag => BLOCKED; EdgeAI-ATR utan bevisad källa => NOT_VERIFIED.
5. Utan faktisk spread/FX/funding/produktdata får framåtblickande netto-R/R inte visas som ett exakt tal.
6. Signerade beslut får inte föras in automatiskt från AI-utdata som om de var självständiga externa signaturer; de är dokumenterade perspektiv.
7. Utförd order utan tidigare styrelsebeslut loggas som PROCESS_BREACH och kan inte godkännas retroaktivt.

## 5. Publiceringschecklista
- Jämför git-gren med aktuell main; ingen force-push, ingen tyst överskrivning.
- Testa backend/frontend, bygg produktionspaket, kontrollera dashboard bakom riktig session samt felhantering.
- Bekräfta att D-1 och marknadsstängningsdata hanteras korrekt för både USA och Sverige.
- Håll originalversionen rollbackbar; användaren publicerar manuellt efter verifiering.
