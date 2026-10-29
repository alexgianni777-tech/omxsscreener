import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { useEffect } from 'react';
import { useListSessions } from '@workspace/api-client-react';
import { AuthProvider, useAuthContext } from './lib/auth-context';
import { Shell } from './components/layout';
import { Today } from './pages/today';
import { Dashboard } from './pages/dashboard';
import { Sessions } from './pages/sessions';
import { SessionDetail } from './pages/session-detail';
import { Import } from './pages/import';
import { Candidates } from './pages/candidates';
import { ChallengeTracker } from './pages/challenge-tracker';
import { Earnings } from './pages/earnings';
import { Portfolio } from './pages/portfolio';
import { Loader2, Lock } from 'lucide-react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
      <h1 className="text-6xl font-bold text-muted-foreground/30">404</h1>
      <p className="text-xl font-medium">Sidan kunde inte hittas</p>
      <a href="/" className="text-primary hover:underline">Till dagens översikt</a>
    </div>
  );
}

function LoginGate() {
  const { isLoading, isAuthenticated, login } = useAuthContext();

  if (isLoading) {
    return (
      <div role="status" aria-live="polite" className="min-h-[100dvh] flex flex-col gap-3 items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Läser behörighet och arbetsyta…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background px-5">
        <div className="flex flex-col items-start gap-6 text-left max-w-md w-full rounded-2xl border border-border bg-card p-7 sm:p-10 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-primary mb-2">Privat researchmiljö</p>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">AG Investment Capital</h1>
            <p className="text-muted-foreground text-sm leading-relaxed mt-3">Inloggning krävs för att visa kandidater, sessionshistorik och portföljdata.</p>
          </div>
          <button
            onClick={login}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-medium py-3 px-6 rounded-lg transition-colors"
          >
            Logga in
          </button>
        </div>
      </div>
    );
  }

  return (
    <Shell>
      <Switch>
        <Route path="/" component={Today} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/sessions" component={Sessions} />
        <Route path="/sessions/today" component={TodaySessionRedirect} />
        <Route path="/sessions/:id" component={SessionDetail} />
        <Route path="/import" component={Import} />
        <Route path="/candidates" component={Candidates} />
        <Route path="/survival" component={ChallengeTracker} />
        <Route path="/portfolio" component={Portfolio} />
        <Route path="/earnings" component={Earnings} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

// #39 — Redirect /sessions/today → latest session detail
function TodaySessionRedirect() {
  const { data: sessions, isLoading } = useListSessions();
  const [, navigate] = useLocation();
  useEffect(() => {
    if (!sessions) return; // still fetching
    if (sessions[0]) navigate(`/sessions/${sessions[0].id}`, { replace: true });
    else navigate("/sessions", { replace: true }); // no sessions at all
  }, [sessions]);
  if (isLoading || !sessions) return (
    <div className="flex items-center justify-center py-20 text-muted-foreground text-sm animate-pulse">
      Laddar senaste session…
    </div>
  );
  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <AuthProvider>
          <LoginGate />
        </AuthProvider>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
