import { useState } from "react";
import { useListCandidates } from "@workspace/api-client-react";
import { formatNumber, formatPercent, formatDate } from "../lib/utils";
import { Link } from "wouter";
import { Filter, Search, ChevronRight } from "lucide-react";

export function Candidates() {
  const [category, setCategory] = useState<string>("");
  const [outcome, setOutcome] = useState<string>("");
  const [direction, setDirection] = useState<string>("");

  const params: any = {};
  if (category) params.category = category;
  if (outcome) params.outcome = outcome;
  if (direction) params.direction = direction;

  const { data: candidates, isLoading, isError } = useListCandidates(params);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Candidate Database</h2>
          <p className="text-muted-foreground mt-1">Filter and review all historical trade candidates.</p>
        </div>
      </header>

      {/* Filters */}
      <div className="bg-card border border-border rounded-lg p-4 flex flex-wrap gap-4 items-center shadow-sm">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mr-2">
          <Filter className="w-4 h-4" /> Filters:
        </div>
        
        <select 
          value={category} 
          onChange={e => setCategory(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">All Categories</option>
          <option value="MOMENTUM">MOMENTUM</option>
          <option value="SQUEEZE">SQUEEZE</option>
          <option value="STUDS">STUDS</option>
          <option value="WEAKEST">WEAKEST</option>
        </select>

        <select 
          value={outcome} 
          onChange={e => setOutcome(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">All Outcomes</option>
          <option value="PENDING">PENDING</option>
          <option value="WIN">WIN</option>
          <option value="LOSS">LOSS</option>
          <option value="SKIP">SKIP</option>
        </select>

        <select 
          value={direction} 
          onChange={e => setDirection(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">All Directions</option>
          <option value="LONG">LONG</option>
          <option value="SHORT">SHORT</option>
        </select>
      </div>

      {/* Data Table */}
      <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted text-muted-foreground text-xs uppercase font-semibold">
              <tr>
                <th className="px-4 py-3">Date / Session</th>
                <th className="px-4 py-3">Ticker</th>
                <th className="px-4 py-3">Dir</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-right">Target</th>
                <th className="px-4 py-3 text-right">Stop</th>
                <th className="px-4 py-3 text-center">Outcome</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground animate-pulse">Loading candidates...</td></tr>
              ) : isError || !candidates ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-destructive">Failed to load data.</td></tr>
              ) : candidates.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">No candidates match these filters.</td></tr>
              ) : (
                candidates.map(c => (
                  <tr key={c.id} className="hover:bg-muted/50 transition-colors group">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link href={`/sessions/${c.sessionId}`} className="text-primary hover:underline">
                        {formatDate(c.sessionDate)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-bold">{c.ticker}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${c.direction === 'LONG' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                        {c.direction}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-muted rounded text-xs font-medium">{c.category}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{formatNumber(c.price)}</td>
                    <td className="px-4 py-3 text-right font-mono text-success">{formatNumber(c.targetPrice)}</td>
                    <td className="px-4 py-3 text-right font-mono text-destructive">{formatNumber(c.stopPrice)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold border ${
                        c.outcome === 'WIN' ? 'border-success text-success bg-success/10' :
                        c.outcome === 'LOSS' ? 'border-destructive text-destructive bg-destructive/10' :
                        c.outcome === 'SKIP' ? 'border-muted-foreground text-muted-foreground bg-muted' :
                        'border-border text-foreground bg-background'
                      }`}>
                        {c.outcome}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/sessions/${c.sessionId}`} className="inline-flex items-center justify-center w-8 h-8 rounded text-muted-foreground hover:bg-background hover:text-primary transition-colors">
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
