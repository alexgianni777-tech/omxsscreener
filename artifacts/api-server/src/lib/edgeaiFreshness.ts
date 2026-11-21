/**
 * Exchange-session freshness for the EdgeAI importer.
 * Uses the exchange-local close buffer (Stockholm 19:00, NY 17:30),
 * weekends and recurring full-session holidays. Unexpected closures fail closed.
 * Never use generatedAt calendar age as a trade-data freshness proxy.
 */
export type MarketKey = "SE" | "US";
export type EdgeMarket = {
  dataAsOf?: string;
  dataStatus?: string;
  indexSnapshot?: { asOf?: string };
  setups?: unknown[];
};
const DAY_MS = 86_400_000;
const iso = (d: Date): string => d.toISOString().slice(0, 10);
const utcDay = (y: number, m: number, day: number): Date => new Date(Date.UTC(y, m - 1, day));
function shifted(d: Date, n: number): Date { return new Date(d.getTime() + n * DAY_MS); }
function observed(y: number, m: number, day: number): string {
  const d = utcDay(y, m, day);
  return iso(shifted(d, d.getUTCDay() === 6 ? -1 : d.getUTCDay() === 0 ? 1 : 0));
}
function nthWeekday(y: number, m: number, weekday: number, n: number): string {
  const first = utcDay(y, m, 1).getUTCDay();
  return iso(utcDay(y, m, 1 + (weekday - first + 7) % 7 + (n - 1) * 7));
}
function lastWeekday(y: number, m: number, weekday: number): string {
  const last = utcDay(y, m + 1, 0);
  return iso(shifted(last, -(last.getUTCDay() - weekday + 7) % 7));
}
// Gregorian computus; Easter Sunday and its dependent exchange holidays.
function easter(y: number): Date {
  const a=y%19, b=Math.floor(y/100), c=y%100, d=Math.floor(b/4), e=b%4;
  const f=Math.floor((b+8)/25), g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30, i=Math.floor(c/4), k=c%4;
  const l=(32+2*e+2*i-h-k+7)%7, m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31);
  const day=(h+l-7*m+114)%31+1;
  return utcDay(y,month,day);
}
function holidaySet(key: MarketKey, y: number): Set<string> {
  const e=easter(y);
  if (key==="US") {
    return new Set([
      observed(y,1,1), observed(y+1,1,1), // include next New Year's observed on Dec 31
      nthWeekday(y,1,1,3), nthWeekday(y,2,1,3),
      iso(shifted(e,-2)), lastWeekday(y,5,1),
      observed(y,6,19), observed(y,7,4),
      nthWeekday(y,9,1,1), nthWeekday(y,11,4,4),
      observed(y,12,25),
    ]);
  }
  const jun19=utcDay(y,6,19);
  const midsummerEve=iso(shifted(jun19,(5-jun19.getUTCDay()+7)%7));
  return new Set([
    iso(utcDay(y,1,1)), iso(utcDay(y,1,6)), iso(shifted(e,-2)),
    iso(shifted(e,1)), iso(utcDay(y,5,1)), iso(shifted(e,39)),
    iso(utcDay(y,6,6)), midsummerEve, iso(utcDay(y,12,24)),
    iso(utcDay(y,12,25)), iso(utcDay(y,12,26)), iso(utcDay(y,12,31)),
  ]);
}
export function isExchangeSession(key: MarketKey, day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const d=new Date(day+"T00:00:00Z");
  if (!Number.isFinite(d.getTime()) || iso(d)!==day) return false;
  if ([0,6].includes(d.getUTCDay())) return false;
  return !holidaySet(key,d.getUTCFullYear()).has(day);
}
export function expectedCompletedSession(key: MarketKey, at: Date = new Date()): string {
  if (!Number.isFinite(at.getTime())) throw new Error("Invalid clock");
  const zone=key==="SE"?"Europe/Stockholm":"America/New_York";
  const cutoff=key==="SE"?19*60:17*60+30;
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{
    timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",hourCycle:"h23",
  }).formatToParts(at).map(p=>[p.type,p.value]));
  let day=utcDay(Number(parts.year),Number(parts.month),Number(parts.day));
  if(Number(parts.hour)*60+Number(parts.minute)<cutoff) day=shifted(day,-1);
  // Bound the search. A missing calendar implementation must not accept anything.
  for(let i=0;i<15;i++,day=shifted(day,-1)){
    const d=iso(day); if(isExchangeSession(key,d)) return d;
  }
  throw new Error("No verified expected exchange session");
}
export function assessEdgeMarket(key:MarketKey, market:EdgeMarket|undefined, at:Date = new Date()) {
  const expected=expectedCompletedSession(key,at);
  const actual=market?.dataAsOf??null;
  const fresh=!!actual && actual===expected && market?.indexSnapshot?.asOf===actual &&
    market?.dataStatus!=="STALE";
  const cache=fresh && market?.dataStatus==="CURRENT_CACHED";
  return {key,expected,actual,fresh,cache,
    reason:!market?"MISSING_MARKET":!fresh?"STALE_OR_UNVERIFIED":cache?"VERIFIED_CACHE":"CURRENT"};
}
export function isValidPublicationTime(generatedAt:unknown, at:Date = new Date()):boolean {
  if(typeof generatedAt!=="string") return false;
  const parsed=Date.parse(generatedAt);
  return Number.isFinite(parsed) && parsed<=at.getTime()+5*60_000;
}
