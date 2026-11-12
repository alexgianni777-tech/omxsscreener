import { timingSafeEqual } from "node:crypto";

/** Shared machine-import auth. Never log the supplied/configured credential. */
export function validImportBearer(header: string | undefined, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const received = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
