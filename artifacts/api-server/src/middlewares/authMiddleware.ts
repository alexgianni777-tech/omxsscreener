import type { AuthUser } from '@workspace/api-zod';
import { type NextFunction, type Request, type Response } from 'express';
import * as oidc from 'openid-client';

import {
  clearSession,
  getOidcConfig,
  getSession,
  getSessionId,
  updateSession,
  type SessionData,
} from '../lib/auth';
import { logger } from '../lib/logger';

declare global {
  namespace Express {
    interface User extends AuthUser {}

    interface Request {
      isAuthenticated(): this is AuthedRequest;

      user?: User | undefined;
    }

    export interface AuthedRequest {
      user: User;
    }
  }
}

async function refreshIfExpired(
  sid: string,
  session: SessionData,
): Promise<SessionData | null> {
  const now = Math.floor(Date.now() / 1000);
  if (!session.expires_at || now <= session.expires_at) return session;

  if (!session.refresh_token) return null;

  try {
    const config = await getOidcConfig();
    const tokens = await oidc.refreshTokenGrant(config, session.refresh_token);
    session.access_token = tokens.access_token;
    session.refresh_token = tokens.refresh_token ?? session.refresh_token;
    session.expires_at = tokens.expiresIn()
      ? now + tokens.expiresIn()!
      : session.expires_at;
    await updateSession(sid, session);
    return session;
  } catch {
    return null;
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request['isAuthenticated'];

  const sid = getSessionId(req);
  if (!sid) {
    next();
    return;
  }

  try {
    const session = await getSession(sid);
    if (!session?.user?.id) {
      await clearSession(res, sid);
      next();
      return;
    }

    const refreshed = await refreshIfExpired(sid, session);
    if (!refreshed) {
      await clearSession(res, sid);
      next();
      return;
    }

    req.user = refreshed.user;
  } catch {
    // DB/session error — treat as unauthenticated, don't crash the request
  }

  next();
}

/** Require a valid browser or mobile session after authMiddleware has hydrated req.user. */
export function requireAuthentication(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

/**
 * Trading data is private. The Repl owner is always the bootstrap administrator;
 * optional allowlists make it possible to grant a second explicitly approved
 * account access without turning ordinary login into authorization.
 */
export function requireAdministrator(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  if (isAdministrator(req.user)) {
    next();
    return;
  }

  logger.warn({ userId: req.user.id }, "Denied trading-data access for non-admin user");
  res.status(403).json({ error: "This account is not approved to access trading data" });
}

export function isAdministrator(user: Express.User): boolean {
  const allowedIds = new Set(
    [
      process.env.REPL_OWNER_ID,
      process.env.REPL_USERID,
      ...(process.env.ADMIN_USER_IDS ?? "").split(","),
    ]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  );
  const allowedEmails = new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const email = user.email?.trim().toLowerCase();

  return allowedIds.has(user.id) || Boolean(email && allowedEmails.has(email));
}
