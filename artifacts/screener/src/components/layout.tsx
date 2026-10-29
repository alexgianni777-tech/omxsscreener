import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { LineChart, Sunrise, LayoutDashboard, History, FileDown, Activity, Swords, CalendarDays, LogOut, Briefcase } from "lucide-react";
import { useAuthContext } from "../lib/auth-context";

export function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuthContext();

  const navItems = [
    { href: "/", label: "Idag", testLabel: undefined as string | undefined, icon: Sunrise },
    { href: "/sessions", label: "Sessioner", testLabel: "Sessions", icon: History },
    { href: "/dashboard", label: "Statistik", icon: LayoutDashboard },
    { href: "/candidates", label: "Kandidater", testLabel: "Candidates", icon: Activity },
    { href: "/import", label: "Import", testLabel: "Import Data", icon: FileDown },
    { href: "/portfolio", label: "Portfölj", icon: Briefcase },
    { href: "/survival", label: "Challenge", testLabel: "Challenge Tracker", icon: Swords },
    { href: "/earnings", label: "Rapporter", icon: CalendarDays },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background">
      {/* Sidebar */}
      <aside className="w-full md:w-60 shrink-0 border-b md:border-b-0 md:border-r border-border bg-sidebar/95 backdrop-blur flex flex-col sticky top-0 z-20 md:static">
        <div className="min-h-14 md:h-20 flex items-center px-4 md:px-5 border-b border-border gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0">
            <LineChart className="w-[18px] h-[18px]" />
          </div>
          <div className="min-w-0">
            <h1 className="font-semibold text-[13px] tracking-tight leading-tight">AG Investment Capital</h1>
            <p className="text-[10px] text-muted-foreground tracking-[.12em] uppercase mt-1">Research & signalöversikt</p>
          </div>
          {user && <button onClick={logout} aria-label="Logga ut" title="Logga ut"
            className="ml-auto rounded-md p-2 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:hidden">
            <LogOut className="h-4 w-4" />
          </button>}
        </div>

        <nav aria-label="Huvudnavigering" className="grid grid-cols-3 md:flex md:flex-col md:flex-1 gap-1 px-2 md:px-3 py-2 md:py-5 md:overflow-y-auto [scrollbar-width:none]">
          {navItems.map((item) => {
            const isActive =
              location === item.href ||
              (item.href !== "/" &&
                location.startsWith(item.href) &&
                // Keep the legacy "latest session" route from lighting up the
                // separate sessions archive item.
                !(item.href === "/sessions" && location.startsWith("/sessions/today")));
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex min-w-0 items-center justify-center md:justify-start whitespace-nowrap px-2 py-2 md:px-3 md:py-2.5 text-[11px] md:text-[13px] font-medium rounded-lg transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary md:shadow-[inset_2px_0_0_hsl(var(--primary))]"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                data-testid={`nav-${(item.testLabel ?? item.label).toLowerCase().replace(' ', '-')}`}
              >
                <item.icon className={`w-4 h-4 shrink-0 mr-1.5 md:mr-3 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="hidden md:block p-4 border-t border-border space-y-3">
          {user && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                {user.profileImageUrl ? (
                  <img src={user.profileImageUrl} alt="" className="w-6 h-6 rounded-full shrink-0" />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-primary/20 shrink-0 flex items-center justify-center text-[10px] font-bold text-primary">
                    {(user.firstName?.[0] ?? user.email?.[0] ?? "?").toUpperCase()}
                  </div>
                )}
                <span className="text-xs text-muted-foreground truncate">
                  {user.firstName ?? user.email ?? "Användare"}
                </span>
              </div>
              <button
                onClick={logout}
                title="Logga ut" aria-label="Logga ut"
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="text-xs text-muted-foreground font-mono">
            Marknad: Nasdaq Stockholm
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 flex flex-col md:h-[100dvh] md:overflow-hidden">
        <div className="flex-1 min-w-0 overflow-y-auto overflow-x-auto px-3 py-5 md:px-8 md:py-8">
          <div className="max-w-7xl mx-auto min-w-0 space-y-6 md:space-y-8 app-enter">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
