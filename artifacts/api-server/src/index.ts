import app from "./app";
import { logger } from "./lib/logger";
// Automatic EdgeAI polling is disabled by request — the user triggers EdgeAI
// import manually from the dashboard instead. scheduler.ts is kept around
// (unused) in case automatic polling is wanted again later.
// import { startScheduler } from "./lib/scheduler";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // Automatic EdgeAI polling disabled — trigger imports manually instead.
});
