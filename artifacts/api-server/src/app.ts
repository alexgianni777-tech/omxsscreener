import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import path from "path";
import { existsSync } from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";

const app: Express = express();

// Replit (and most PaaS) run behind a reverse proxy that sets X-Forwarded-For.
// Without this, express-rate-limit throws a ValidationError on every request.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(express.json());

// General rate limiter — 200 req/min per IP
app.use(
  "/api",
  rateLimit({
    windowMs: 60_000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests — try again in a minute." },
  }),
);

// Stricter limit on EdgeAI import (hits external service)
app.use(
  "/api/screener/sessions/import-from-edgeai",
  rateLimit({
    windowMs: 60_000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "EdgeAI import rate limit — max 5 per minute." },
  }),
);
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

app.use("/api", router);

// In production, serve the built Vite frontend from the same Express process.
// The frontend is built to artifacts/screener/dist/public relative to the repo root.
if (process.env.NODE_ENV === "production") {
  const staticDir = path.resolve(process.cwd(), "artifacts/screener/dist/public");
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));
    // Catch-all: serve index.html for client-side routing (wouter)
    app.get("*splat", (_req, res) => {
      res.sendFile(path.join(staticDir, "index.html"));
    });
    logger.info({ staticDir }, "Serving frontend static files");
  } else {
    logger.warn({ staticDir }, "Production static dir not found — frontend not served");
  }
}

export default app;
