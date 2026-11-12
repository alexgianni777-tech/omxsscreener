import React,{useState} from "react";
import {BOARD_PERSPECTIVES,BOARD_REVIEW_REQUIRED,boardArchive} from "@workspace/market-calendar/research-policy";

/** Manual export only: no localStorage, credentials, API writes or AI signatures. */
export function BoardReview({context}:{context:string}) {
  const [notes,setNotes]=useState<string[]>(["","","","",""]);
  const [chat,setChat]=useState("");
  const [risk,setRisk]=useState({capital:"",stake:"",loss:"",source:""});
  const [error,setError]=useState("");
  const amounts=[risk.capital,risk.stake,risk.loss].map(v=>v.trim()?Number(v.replace(",",".")):NaN);
  const numeric=amounts.every(n=>Number.isFinite(n)&&n>0);
  const excessive=numeric&&(amounts[1]/amounts[0]>.2||amounts[2]/amounts[0]>.04);
  function archive() {
    try {
      const riskText=`Manuellt angivna SEK-belopp: kapital ${risk.capital||"okänt"}, insats ${risk.stake||"okänd"}, `+
        `planerad aktiestop-förlust ${risk.loss||"okänd"}. Källa/FX/datum ${risk.source||"ej verifierat"}. `+
        `Riskstatus ${excessive?"ÖVER RISKTAK – EJ GODKÄND":"UNDERLAG EJ SYSTEMVERIFIERAT"}.`;
      const text=boardArchive(`${context}\n${riskText}`,chat,notes,new Date().toISOString());
      const url=URL.createObjectURL(new Blob([text],{type:"text/plain;charset=utf-8"}));
      const a=document.createElement("a");a.href=url;a.download="board-review.txt";a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);setError("");
    } catch(e){setError(e instanceof Error?e.message:"Protokollet kunde inte exporteras.");}
  }
  const input="mt-1 w-full rounded border border-border bg-background p-2 text-sm";
  return <details className="mt-3 border-t border-border pt-2 text-xs" data-testid="board-review">
    <summary className="cursor-pointer font-medium">{BOARD_REVIEW_REQUIRED} · manuellt protokoll</summary>
    <p className="mt-2">Endast underliggande aktier. Kvalificerad datasignal är inte en godkänd order.
      Fem perspektiv ska dokumenteras uttryckligen i din chatt. Detta är mänsklig dokumentation, inte AI-signaturer.</p>
    <p className="mt-1 break-words">{context}</p>
    <label className="mt-2 block">Chattreferens och granskningsdatum
      <input className={input} value={chat} maxLength={500} onChange={e=>setChat(e.target.value)} /></label>
    {BOARD_PERSPECTIVES.map(([role,prompt],i)=><label key={role} className="mt-2 block font-medium">{role} – {prompt}
      <textarea className={input} rows={2} value={notes[i]} maxLength={4000}
        onChange={e=>setNotes(old=>old.map((v,j)=>j===i?e.target.value:v))} /></label>)}
    <p className="mt-2">Dokumentera faktisk insats och aktiestop-risk, inte derivatets hävstång.
      Stop garanterar inte förlusttak vid gap. Konservativt exempel 0,5–1 %; absolut planeringsgräns 20 % insats/4 % förlust.</p>
    <div className="grid gap-2 sm:grid-cols-3">
      {([["capital","Verifierat kapital, SEK"],["stake","Insats, SEK"],["loss","Planerad aktiestop-förlust, SEK"]] as const).map(([k,label])=>
        <label key={k}>{label}<input className={input} inputMode="decimal" value={risk[k]}
          onChange={e=>setRisk({...risk,[k]:e.target.value})} /></label>)}
    </div>
    <label className="mt-2 block">Källa, datum och FX-underlag för beloppen
      <input className={input} maxLength={1000} value={risk.source} onChange={e=>setRisk({...risk,source:e.target.value})}/></label>
    <p role="status" className="mt-2">{excessive?"BLOCKERAD – manuellt angivna belopp överskrider risktaket.":
      numeric?"Räkneexempel inom risktaken; belopp, FX och underlag är ännu inte systemverifierade.":"Riskunderlag saknas – ej godkänt."}</p>
    <p className="mt-1">Kostnader/netto-R/R, rapportdatum och korrelation förblir okända tills verkligt underlag finns.
      Export arkiverar bara ditt utlåtande; den aktiverar inte TRADEABLE/READY och placerar aldrig order.
      Ingen automatisk lagring. Klistra inte in lösenord, tokens eller andra autentiseringsuppgifter.</p>
    <button type="button" onClick={archive} className="mt-2 rounded border border-border px-3 py-2 text-sm">Arkivera utlåtande (.txt)</button>
    {error&&<p role="alert" className="mt-1 text-destructive">{error}</p>}
  </details>;
}
