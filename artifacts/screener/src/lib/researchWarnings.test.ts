import test from "node:test";
import assert from "node:assert/strict";
import {summarizeResearchWarnings} from "./researchWarnings";

test("historical date gap is the main reason; equivalent report/ATR warnings are grouped, originals preserved",()=>{
  const raw=["UNKNOWN_REPORT_DATE – ingen TRADEABLE/READY",
    "Rapportkontroll: UNKNOWN_REPORT_DATE · källa edgeai",
    "ATR för underliggande är inte verifierad; inget edge-fält som ATR.",
    "ATR för underliggande ej verifierad; edge-statistik ersätter inte ATR.",
    "STALE/UNKNOWN_DATA_DATE – senaste avslutade marknadsdag krävs.",
    "Signal eller marknadsdag är STALE.",
    "RESEARCH ONLY – upstream kvalificerar inte denna setup för entry.",
    "Screeningkvalificering är inte verifierad; inget entrybesked."];
  const before=JSON.stringify(raw);
  const r=summarizeResearchWarnings(raw,{stale:true,dataDate:"2026-11-05",expectedDataDate:"2026-11-11"});
  assert.match(r.primary,/2026-11-05.*2026-11-11.*Ingen ny entry/);
  assert.equal(r.details.filter(x=>x.includes("UNKNOWN_REPORT_DATE")).length,1);
  assert.equal(r.details.filter(x=>x.startsWith("ATR")).length,1);
  assert.ok(r.details.some(x=>x.startsWith("RESEARCH ONLY")));
  assert.deepEqual(r.audit,raw);
  assert.equal(JSON.stringify(raw),before);
});
test("current conflicting or unknown evidence is never rewritten as approved",()=>{
  for(const reason of ["Källkonflikt – ingen entrybekräftelse","Upstream-kvalificering okänd","UNKNOWN_REPORT_DATE"]){
    const r=summarizeResearchWarnings([reason],{stale:false});
    assert.equal(r.primary,reason);
    assert.deepEqual(r.audit,[reason]);
  }
  assert.match(summarizeResearchWarnings([],{stale:true}).primary,/datadag ej verifierad/);
});
