# Schema Safety — Förhindra dataförlust vid kolumnändringar

## Risken

Det här projektet använder `drizzle-kit push` (inte `migrate`). Det innebär att
Drizzle Kit jämför schemat mot live-databasen och applicerar ändringar direkt.

**En kolumnändring som ser ofarlig ut kan raderar data:**

| Förändring | Effekt med `push` |
|---|---|
| Byta namn på en kolumn | Drizzle skapar ny kolumn + raderar gammal (data försvinner) |
| Ändra typ (t.ex. `int` → `real`) | Kan misslyckas eller konvertera fel |
| Ta bort ett fält från schemat | Kolumnen droppas i produktion |

## Säkert arbetsflöde innan du pushar till produktion

### 1. Generera SQL-diff först (se vad som händer)

Drizzle Kit kan generera SQL-filer som visar exakt vad som körs:

```bash
# Lägg till generate-scriptet i lib/db/package.json
pnpm --filter @workspace/db run generate   # skapar migrations/XXXX.sql
```

Granska SQL-filen. Om du ser `ALTER TABLE DROP COLUMN` eller `RENAME COLUMN` — stoppa.

### 2. För kolumnnamnsbyten — gör det i tre steg

```
Steg 1: Lägg till NYA kolumnen (backfill i kod)
Steg 2: Verifiera att ny kolumn fungerar i produktion
Steg 3: Ta bort GAMLA kolumnen
```

### 3. För nya kolumner — alltid nullable eller med DEFAULT

Alla nya kolumner måste ha ett defaultvärde eller vara nullable, annars
misslyckas `push` på befintliga rader.

## Lägg till generate-script

I `lib/db/package.json` scripts:

```json
"generate": "drizzle-kit generate --config ./drizzle.config.ts",
"check": "drizzle-kit check --config ./drizzle.config.ts"
```

## Automatiskt skydd vid produktionsdeploy

`pnpm --filter @workspace/db run push` (som körs av `railway.toml` vid varje
publicering) kör numera `check-destructive-push` FÖRST. Det scriptet
(`lib/db/scripts/check-destructive-push.ts`) jämför schemat i kod mot den
LIVE produktionsdatabasen och avbryter deployen (exit code 1, appen startar
aldrig) om det upptäcker:

- En kolumn som finns i databasen men saknas i schemat (skulle droppas)
- En hel tabell som finns i databasen men saknas i schemat (skulle droppas)
- En kolumn vars typ i databasen inte matchar vad schemat förväntar sig

Detta är exakt scenarierna i tabellen ovan — de som annars skulle lösas tyst
av `drizzle-kit push` eftersom det inte finns någon interaktiv terminal i en
produktionsdeploy.

**Avsiktlig borttagning (steg 3 i tre-stegsprocessen ovan):** sätt miljövariabeln
`ALLOW_SCHEMA_DATA_LOSS=true` för den specifika deployen för att hoppa över
kontrollen. Ta bort variabeln igen direkt efteråt.

Kör kontrollen manuellt när som helst med:

```bash
pnpm --filter @workspace/db run check-destructive-push
```

## Kolumnreferenser (aktuell schema → DB-kolumn)

| Fält i kod | Kolumn i DB | Tabell |
|---|---|---|
| `edgeWinRate` | `edge_win_rate` | `screener_sessions` |
| `edgeExpectancy` | `edge_expectancy` | `screener_sessions` |
| `perf1m` | `perf_1m` | `candidates` |
| `entryPrice` | `entry_price` | `candidates` |
| `stopPrice` | `stop_price` | `candidates` |
| `targetPrice` | `target_price` | `candidates` |
| `isTop3Pick` | `is_top3_pick` | `candidates` |
| `earningsInDays` | `earnings_in_days` | `candidates` |
