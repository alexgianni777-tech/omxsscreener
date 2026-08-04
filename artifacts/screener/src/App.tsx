import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Shell } from './components/layout';
import { Dashboard } from './pages/dashboard';
import { Sessions } from './pages/sessions';
import { SessionDetail } from './pages/session-detail';
import { Import } from './pages/import';
import { Candidates } from './pages/candidates';

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
      <p className="text-xl font-medium">Page not found</p>
      <a href="/" className="text-primary hover:underline">Return to Dashboard</a>
    </div>
  );
}

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/sessions" component={Sessions} />
        <Route path="/sessions/:id" component={SessionDetail} />
        <Route path="/import" component={Import} />
        <Route path="/candidates" component={Candidates} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Router />
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
