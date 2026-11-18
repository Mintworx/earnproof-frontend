# Authenticated session inventory (v1)

`GET /auth/sessions?state=active|revoked&cursor=...`,
`DELETE /auth/sessions/{id}` and `POST /auth/sessions/revoke-others`
are described in the versioned OpenAPI fixture. A backend deployment must
implement them and authorize every operation against the bearer principal;
client account checks are an additional guard, never server authorization.
Unavailable endpoints and invalid responses fail closed. Legacy browser session
inventories are ignored, never promoted into authenticated state.

The server identifies the current session through currentSessionId. The UI
does not infer it from local user IDs or browser fingerprints. Response schemas
strip extra fields. Device labels contain only a supported OS and browser family;
raw tokens, full user agents, IPs and unknown labels never reach rendering.
Pagination is cancellable, bounded and rejects malformed/repeated cursors.
Refresh and focus start a new server inventory; read failures remove stale rows.

Revocation is server-confirmed and not automatically retried. The backend must
return a consistent idempotent response to an already revoked ID belonging to
the principal. Its currentSessionRevoked flag triggers in-memory session logout,
cross-tab logout broadcast, query-cache clearing, protected storage cleanup,
and document replacement to discard remaining React/module caches. Other-session
revocation preserves the current session. Pending controls block duplicate sends.
Auth changes remount the workspace and abort outstanding reads and mutations.

Focused Jest/RTL tests cover server scope, response privacy, pagination, replay,
authorization, revocation and cancellation. Required full commands are
`npm run lint`, `npm test -- --runInBand`, `npm run build` and
`npm run test:contracts`. Use synthetic fixtures only.
