"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { readStoredSession, clearStoredSession } from "@/lib/session";
import { useSessionToken } from "@/lib/use-session";
import { clearAllStorage } from "@/lib/storage";
import { listSessionPage, listRecentlyRevokedSessions, type SessionRecord } from "@/lib/sessions/store";
import { SessionRiskHistory } from "./session-risk-history";
import { SessionList } from "./session-list";
import { RecentAuthExplainer } from "@/components/auth/recent-auth-explainer";

export interface SessionManagementProps { organizationId?: string; viewerOrganizationId?: string; lastVerifiedAtMs?: number | null }
export function SessionManagement(props: SessionManagementProps = {}) {
  const token = useSessionToken();
  return token ? <SessionWorkspace key={token} {...props} /> : <p role="alert">Authentication required. Connect your wallet to view sessions.</p>;
}
function SessionWorkspace({ lastVerifiedAtMs, organizationId, viewerOrganizationId }: SessionManagementProps) {
  const [session] = useState(() => readStoredSession()!);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [revoked, setRevoked] = useState<SessionRecord[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const visited = useRef(new Set<string>());
  const load = useCallback(async (cursor: string | null = null) => {
    request.current?.abort(); const c = new AbortController(); request.current = c;
    setLoading(true); setError(null);
    if (cursor === null) { setSessions([]); setRevoked([]); setNext(null); visited.current.clear(); }
    try {
      const [page, revokedRows] = await Promise.all([listSessionPage(session.user.id, cursor, c.signal), organizationId ? listRecentlyRevokedSessions(session.user.id, c.signal) : Promise.resolve([])]);
      if (c.signal.aborted) return;
      if (page.nextCursor && visited.current.has(page.nextCursor)) throw new Error("Repeated cursor");
      if (cursor) visited.current.add(cursor);
      setSessions(previous => {
        const combined = cursor ? [...previous, ...page.sessions] : page.sessions;
        return [...new Map(combined.map(item => [item.id, item])).values()];
      }); setNext(page.nextCursor); setRevoked(revokedRows);
    } catch {
      if (!c.signal.aborted) { setSessions([]); setNext(null); setError("Could not load server sessions. Refresh to retry."); }
    } finally { if (!c.signal.aborted) setLoading(false); }
  }, [session.user.id, organizationId]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void load(); });
    const focus = () => void load(); window.addEventListener("focus", focus);
    return () => { active = false; request.current?.abort(); window.removeEventListener("focus", focus); };
  }, [load]);
  function logout() {
    request.current?.abort();
    clearStoredSession(); clearAllStorage();
    // Replace the document so no protected React or other module cache survives.
    window.location.replace("/proofs");
  }
  return <div className="grid gap-6" aria-busy={loading}>
    <RecentAuthExplainer lastVerifiedAtMs={lastVerifiedAtMs ?? null} />
    <h2 className="text-xl font-semibold text-white">Active Sessions</h2>
    <button type="button" disabled={loading} onClick={() => void load()}>Refresh</button>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Loading sessions...</p>}
    <SessionList userId={session.user.id} sessions={sessions} loading={loading} onSessionsChanged={() => void load()} onCurrentSessionRevoked={logout} />
    {next && <button type="button" disabled={loading} onClick={() => void load(next)}>Load more sessions</button>}
    {organizationId && <SessionRiskHistory userId={session.user.id} organizationId={organizationId} viewerOrganizationId={viewerOrganizationId ?? organizationId} activeSessions={sessions} revokedSessions={revoked} onRemoteSignOutCompleted={() => void load()} />}
  </div>;
}
