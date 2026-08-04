import { useState, useRef } from "react";
import { useImportSession, getListSessionsQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Terminal, Upload, AlertTriangle } from "lucide-react";

export function Import() {
  const [rawText, setRawText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const importSession = useImportSession();
  const queryClient = useQueryClient();

  const handleImport = () => {
    if (!rawText.trim()) {
      setError("Please paste screener output first.");
      return;
    }
    
    setError(null);
    importSession.mutate(
      { data: { rawText } },
      {
        onSuccess: (data) => {
          queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
          setLocation(`/sessions/${data.id}`);
        },
        onError: (err: any) => {
          setError(err?.error || "Failed to parse and import session. Check format.");
        }
      }
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header>
        <h2 className="text-3xl font-bold tracking-tight">Import Screener Data</h2>
        <p className="text-muted-foreground mt-1">Paste the raw text output from your daily screener tool.</p>
      </header>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive border border-destructive/20 rounded-md flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden flex flex-col">
        <div className="bg-muted px-4 py-2 border-b border-border flex items-center gap-2 text-xs font-mono text-muted-foreground">
          <Terminal className="w-4 h-4" />
          RAW_INPUT.txt
        </div>
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder="Paste screener text here...&#10;Must include 'OMXS30 MARKET WEATHER' and candidate categories."
          className="w-full h-[500px] p-4 bg-transparent font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
          spellCheck={false}
          data-testid="input-raw-text"
        />
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleImport}
          disabled={importSession.isPending}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background bg-primary text-primary-foreground hover:bg-primary/90 h-11 px-8 shadow-sm"
          data-testid="btn-parse-import"
        >
          {importSession.isPending ? (
            <span className="animate-pulse">Parsing...</span>
          ) : (
            <>
              <Upload className="w-4 h-4 mr-2" />
              Parse & Import
            </>
          )}
        </button>
      </div>
    </div>
  );
}
