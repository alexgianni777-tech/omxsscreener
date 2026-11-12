import type {CashEvidence,CashSource} from "./cashResearch";
export const CASH_TEST_NOW=Date.parse("2026-11-12T10:00:00Z");
/** Synthetic unit-test data only; no issuer data, no production adapter. */
export function cashTestEvidence(weak=false):CashEvidence {
  const ref=(documentId:string,publishedAt:string):CashSource=>({kind:"TEST_FIXTURE",name:"DEMO TEST ONLY",
    documentId,publishedAt,verification:"DOCUMENT_MATCHED"});
  const source=ref("DEMO-FILING-CURRENT","2026-10-20T08:00:00Z");
  const basis={entityId:"DEMO-ENTITY",currency:"SEK",scope:"CONSOLIDATED" as const};
  return {ticker:"DEMO-B",market:"SE",entityId:basis.entityId,asOf:"2026-11-12T09:00:00Z",
    balance:{...basis,source,period:"2026-09-30",cash:weak?1:100,shortTermInvestments:weak?0:20,
      interestBearingDebt:weak?250:50,debtDefinition:"INCLUDING_LEASES"},
    current:{...basis,source,start:"2025-10-01",end:"2026-09-30",basis:"TTM",
      method:"OPERATING_CASH_FLOW_MINUS_CAPEX",operatingCashFlow:weak?5:20,capex:10,
      netIncome:weak?5:12,ebit:weak?5:20,interestExpense:5,ebitda:25},
    previous:{...basis,source:ref("DEMO-FILING-PREVIOUS","2025-10-20T08:00:00Z"),start:"2024-10-01",end:"2025-09-30",
      basis:"TTM",method:"OPERATING_CASH_FLOW_MINUS_CAPEX",operatingCashFlow:18,capex:10,netIncome:10,ebit:15,interestExpense:5},
    policy:{id:"DEMO EXPLICIT TEST POLICY",valuationMetric:"PE_TTM",maxStrongMultiple:15,minWeakMultiple:25,
      minWeakDebtToEbitda:3,maxWeakCoverage:1.5,maxStatementAgeDays:120},
    valuation:{entityId:basis.entityId,currency:"SEK",period:"2026-09-30",metric:"PE_TTM",multiple:weak?30:10,
      asOf:"2026-11-12T09:00:00Z",priceDataAsOf:"2026-11-11",source:ref("DEMO-VALUATION","2026-11-12T08:00:00Z")},
    priceTrend:{ticker:"DEMO-B",market:"SE",close:weak?90:110,sma50:weak?95:105,sma200:100,
      dataAsOf:"2026-11-11",observedAt:"2026-11-12T09:00:00Z",instrumentType:"UNDERLYING_EQUITY",
      source:ref("DEMO-DAILY-CLOSES","2026-11-11T16:30:00Z")},
    report:{date:"2026-12-15",source:ref("DEMO-CALENDAR","2026-11-01T08:00:00Z")}};
}
