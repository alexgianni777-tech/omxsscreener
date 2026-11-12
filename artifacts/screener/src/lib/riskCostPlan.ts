export type CostEvidence = {
  grossRiskKr:number; grossRewardKr:number; spreadCostKr:number; commissionKr:number; fundingKr:number;
  fx:number; asOf:string; source:string; instrumentId:string; contractTermsVerified:boolean; marketState:string;
};
export function netRiskReward(e?:CostEvidence, now=Date.now()) {
  if (!e || e.contractTermsVerified!==true || e.marketState!=="REGULAR" ||
    typeof e.source!=="string" || !e.source.trim() || typeof e.instrumentId!=="string" || !e.instrumentId.trim() ||
    typeof e.asOf!=="string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(e.asOf) ||
    ![e.grossRiskKr,e.grossRewardKr,e.fx].every(n=>Number.isFinite(n)&&n>0) ||
    ![e.spreadCostKr,e.commissionKr,e.fundingKr].every(n=>Number.isFinite(n)&&n>=0) ||
    !Number.isFinite(Date.parse(e.asOf)) || Date.parse(e.asOf)>now || now-Date.parse(e.asOf)>300_000) return null;
  const costs=e.spreadCostKr+e.commissionKr+e.fundingKr;
  const rr=(e.grossRewardKr-costs)/(e.grossRiskKr+costs);
  return Number.isFinite(rr)&&rr>0?rr:null;
}
export function riskBudget(accountEquity:number|null,stake:number|null,maximumLoss:number|null,fxVerified=false) {
  if (!fxVerified || ![accountEquity,stake,maximumLoss].every(n=>typeof n==="number"&&Number.isFinite(n)&&n>0))
    return "NOT_VERIFIED";
  return stake!/accountEquity!>0.2 || maximumLoss!/accountEquity!>0.04?"BLOCKED":"PASS";
}
