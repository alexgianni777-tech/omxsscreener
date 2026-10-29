import { prepareE2ETestMode } from "./lib/e2eTestSafety";

// Validate the database boundary before importing the app or DB module. This
// prevents even a pool connection from being constructed for an unsafe target.
const e2eTestMode = prepareE2ETestMode(process.env);

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function main() {
  const [{ default: app }, { logger }, { startScheduler }, { runMigrations }] = await Promise.all([
    import("./app"),
    import("./lib/logger"),
    import("./lib/scheduler"),
    import("./lib/migrate"),
  ]);

  // Replit Publish applies the managed production schema before starting the
  // service. Running the local Drizzle journal there would attempt to add
  // columns/tables that Publish has already created and crash startup.
  // Development still applies versioned migrations before accepting traffic.
  if (process.env["NODE_ENV"] !== "production") {
    await runMigrations();
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    // Start only after listen succeeds: migrations and the HTTP startup path
    // are complete, and the scheduler can safely use the live DB connection.
    if (!e2eTestMode) startScheduler();
    else logger.warn("E2E_TEST active — scheduler disabled; only isolated test database is allowed.");
  });
}

main().catch((err) => {
  console.error("Fatal startup error — process cannot continue", err);
  process.exit(1);
});
