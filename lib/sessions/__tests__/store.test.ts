import { apiClient } from "@/lib/api/client";
import { readStoredSession } from "@/lib/session";
import { listSessionPage, listActiveSessions, revokeSession, revokeAllOtherSessions } from "../store";
jest.mock("@/lib/api/client", () => ({ apiClient: jest.fn(), bearer: (token: string) => ({ Authorization: `Bearer ${token}` }) }));
jest.mock("@/lib/session", () => ({ readStoredSession: jest.fn() }));
const api = jest.mocked(apiClient);
const record = { id: "session-1", deviceLabel: "Linux - Firefox", createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-02T00:00:00.000Z", revokedAt: null };
const page = { sessions: [record], currentSessionId: "session-1", nextCursor: null };
beforeEach(() => { jest.clearAllMocks(); localStorage.clear(); jest.mocked(readStoredSession).mockReturnValue({ token: "synthetic-auth", user: { id: "user-1", role: "WORKER", walletAddress: "synthetic-wallet", walletHash: "synthetic-hash" } }); });
it("loads only authenticated server state and strips private metadata", async () => {
  localStorage.setItem("earnproof.sessions.user-1", "forged-data");
  api.mockResolvedValue({ ...page, sessions: [{ ...record, token: "private", userAgent: "private", ipAddress: "private", isCurrent: false }] });
  expect((await listSessionPage("user-1")).sessions).toEqual([{ ...record, isCurrent: true }]);
});
it("follows pagination and uses server current-session identity", async () => {
  api.mockResolvedValueOnce({ ...page, nextCursor: "next-1" }).mockResolvedValueOnce({ ...page, sessions: [{ ...record, id: "session-2" }] });
  const records = await listActiveSessions("user-1");
  expect(records.map(item => item.isCurrent)).toEqual([true, false]);
  expect(api.mock.calls[1][0].path).toContain("cursor=next-1");
});
it("rejects cursor replay and malformed/private device labels", async () => {
  api.mockResolvedValue({ ...page, nextCursor: "same" });
  await expect(listSessionPage("user-1", "same")).rejects.toThrow("Repeated cursor");
  api.mockResolvedValue({ ...page, sessions: [{ ...record, deviceLabel: "Mozilla/5.0 full user agent" }] });
  await expect(listSessionPage("user-1")).rejects.toThrow();
});
it("rejects revoked entries in the active page and duplicate identities", async () => {
  api.mockResolvedValue({ ...page, sessions: [{ ...record, revokedAt: "2026-01-02T00:00:00.000Z" }] });
  await expect(listSessionPage("user-1")).rejects.toThrow();
  api.mockResolvedValue({ ...page, sessions: [record, record] });
  await expect(listSessionPage("user-1")).rejects.toThrow();
});
it("rejects cross-account calls before sending", async () => {
  await expect(revokeSession("other-user", "session-1")).rejects.toThrow("Authentication");
  expect(api).not.toHaveBeenCalled();
});
it("supports server-confirmed current revocation and propagates cancellation", async () => {
  const controller = new AbortController();
  api.mockResolvedValue({ revokedSessionId: "session-1", currentSessionRevoked: true });
  expect((await revokeSession("user-1", "session-1", controller.signal)).currentSessionRevoked).toBe(true);
  expect(api).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", signal: controller.signal }));
});
it("does not retry failed revocations or fabricate a count", async () => {
  api.mockRejectedValue(new Error("Forbidden"));
  await expect(revokeAllOtherSessions("user-1")).rejects.toThrow("Forbidden"); expect(api).toHaveBeenCalledTimes(1);
  api.mockResolvedValue({ revokedCount: 2 }); expect(await revokeAllOtherSessions("user-1")).toBe(2);
});
