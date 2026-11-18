import { z } from "zod";
import { apiClient, bearer } from "@/lib/api/client";
import { readStoredSession } from "@/lib/session";
import { validateApiResponse } from "@/lib/validation/runtime-response";
import { isValidOpaqueCursor } from "@/lib/api/opaque-cursor";

// No local seed data or localStorage authority. Device labels have a closed vocabulary.
const device = z.string().regex(/^(iOS|Android|macOS|Windows|Linux|Unknown device) - (Chrome|Firefox|Safari|Edge|Opera|Unknown browser)$/);
const wireSession = z.object({ id: z.string().min(1), deviceLabel: device, createdAt: z.iso.datetime(), lastUsedAt: z.iso.datetime(), revokedAt: z.iso.datetime().nullable() });
export type SessionRecord = z.infer<typeof wireSession> & { isCurrent: boolean };
const pageSchema = z.object({ sessions: z.array(wireSession).max(100), currentSessionId: z.string().min(1), nextCursor: z.string().refine(isValidOpaqueCursor).nullable() });
function headers(userId: string) {
  const session = readStoredSession();
  if (!session || session.user.id !== userId) throw new Error("Authentication required.");
  return bearer(session.token);
}
export async function listSessionPage(userId: string, cursor: string | null = null, signal?: AbortSignal, state: "active" | "revoked" = "active") {
  if (cursor !== null && !isValidOpaqueCursor(cursor)) throw new Error("Invalid cursor.");
  const page = validateApiResponse(pageSchema, await apiClient<unknown>({ path: `/auth/sessions?state=${state}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, headers: headers(userId), signal }));
  if (page.nextCursor !== null && page.nextCursor === cursor) throw new Error("Repeated cursor.");
  if (new Set(page.sessions.map(item => item.id)).size !== page.sessions.length || page.sessions.some(item => state === "active" ? item.revokedAt !== null : item.revokedAt === null)) throw new Error("Invalid session page.");
  return { ...page, sessions: page.sessions.map(item => ({ ...item, isCurrent: item.id === page.currentSessionId })) };
}
async function listAll(userId: string, state: "active" | "revoked", signal?: AbortSignal): Promise<SessionRecord[]> {
  const records: SessionRecord[] = []; const seen = new Set<string>(); let cursor: string | null = null;
  for (let i = 0; i < 100; i++) {
    const page = await listSessionPage(userId, cursor, signal, state);
    for (const record of page.sessions) { if (seen.has(record.id)) throw new Error("Duplicate session."); seen.add(record.id); records.push(record); }
    if (page.nextCursor === null) return records;
    if (seen.has(`cursor:${page.nextCursor}`)) throw new Error("Repeated cursor.");
    seen.add(`cursor:${page.nextCursor}`); cursor = page.nextCursor;
  }
  throw new Error("Session inventory exceeds page limit.");
}
export const listActiveSessions = (userId: string, signal?: AbortSignal) => listAll(userId, "active", signal);
export const listRecentlyRevokedSessions = (userId: string, signal?: AbortSignal) => listAll(userId, "revoked", signal);
const revokeResult = z.object({ revokedSessionId: z.string().min(1), currentSessionRevoked: z.boolean() });
export async function revokeSession(userId: string, id: string, signal?: AbortSignal) {
  const result = validateApiResponse(revokeResult, await apiClient<unknown>({ path: `/auth/sessions/${encodeURIComponent(id)}`, method: "DELETE", headers: headers(userId), signal }));
  if (result.revokedSessionId !== id) throw new Error("Revocation scope mismatch.");
  return result;
}
export async function revokeAllOtherSessions(userId: string, signal?: AbortSignal): Promise<number> {
  const result = validateApiResponse(z.object({ revokedCount: z.number().int().nonnegative() }), await apiClient<unknown>({ path: "/auth/sessions/revoke-others", method: "POST", headers: headers(userId), signal }));
  return result.revokedCount;
}
