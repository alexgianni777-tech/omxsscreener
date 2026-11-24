import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
test("dashboard keeps official and current selections ahead of folded historical analysis without unmounting features", () => {
  const s = source("../pages/dashboard.tsx");
  assert.ok(s.indexOf("<MarketIntelSection />") < s.indexOf("<SavedTop3 omxs30Only />"));
  assert.ok(s.indexOf("<SavedTop3 omxs30Only />") < s.indexOf("<TodaySessionPanel />"));
  assert.ok(s.indexOf("<DashboardLiveTop3 />") < s.indexOf('data-testid="details-historical-stats"'));
  for (const tag of ["details-historical-stats", "details-trade-journal", "details-manual-catalysts", "details-groundzero"])
    assert.ok(s.includes(tag));
  assert.equal((s.match(/<DashboardLiveTop3 \/>/g) ?? []).length, 1);
  assert.ok(s.includes("<TradeJournal />")); assert.ok(s.includes("<GroundZero />"));
  const home = source("../pages/today.tsx");
  assert.ok(home.indexOf("<MarketIntelSection />") < home.indexOf("<SavedTop3 />"));
  assert.ok(home.indexOf("<SavedTop3 />") < home.indexOf("Challenge · registrerat modellkonto"));
  assert.ok(home.includes("max-w-5xl"));
  assert.ok(home.includes("if (!sessionsResponse.ok) throw new Error"));
  assert.ok(home.includes('data-testid="status-session-load-error"'));
  assert.ok(home.includes('data-testid="status-challenge-load-error"'));
});
test("dashboard Top 3 cards use dated OMXS30 scope and separate archive display", () => {
  const dashboard = source("../pages/dashboard.tsx");
  const live = source("./DashboardLiveTop3.tsx");
  const saved = source("./SavedTop3.tsx");
  assert.ok(dashboard.includes("filterActiveOmxs30Picks"));
  assert.ok(dashboard.includes("filterArchivedOmxs30Picks"));
  assert.ok(dashboard.includes('data-testid="toggle-dashboard-top3-archive"'));
  assert.ok(live.includes("OMXS30_TOP3_POLICY_VERSION"));
  assert.ok(live.includes("filterActiveOmxs30Picks"));
  assert.ok(live.includes("filterArchivedOmxs30Picks"));
  assert.ok(live.includes("revisions={revisions}"));
  assert.ok(saved.includes("filterActiveOmxs30Picks"));
  assert.ok(saved.includes("filterArchivedOmxs30Picks"));
  assert.ok(saved.includes('data-testid="toggle-saved-top3-archive"'));
  assert.ok(!saved.includes("LiveEntryGuard"));
});
test("mobile layout preserves logout and nav semantics and tables scroll rather than getting globally clipped", () => {
  const layout = source("./layout.tsx"), css = source("../index.css");
  assert.ok(layout.includes('aria-label="Huvudnavigering"')); assert.ok(layout.includes('aria-current={isActive ? "page"'));
  assert.ok(layout.includes("md:hidden")); assert.ok(layout.includes("onClick={logout}"));
  assert.ok(layout.includes('!(item.href === "/sessions" && location.startsWith("/sessions/today"))'));
  assert.ok(layout.includes("min-w-0")); assert.ok(layout.includes("overflow-x-auto"));
  assert.ok(!css.includes("html, body { overflow-x: hidden"));
  assert.ok(source("../pages/candidates.tsx").includes('className="overflow-x-auto"'));
  assert.ok(source("./TradeJournal.tsx").includes("overflow-x-auto"));
});
