# Strong API — Endpoint Inventory

Reverse-engineered map of the Strong backend REST API at `https://back.strong.app`.

**How it was discovered**: the iOS/Android app talks to this host. It is visible as the
`iss`/`aud` claim of the login JWT and confirmed by five independent community clients
(tolik518/strong-api-workout-sync, jerhinesmith/strong-mcp, TheAlexLichter/strong-exporter,
pratyaksh123/strong-api, ivanvmoreno/strong-skill). Verified live (2026-08): the
public measurements endpoint responds with 253 exercises.

> The older Parse-based backend (`ws13.strongapp.co/parse/...`, 2023-era, documented by
> dmzoneill/strongapp-api) is **not** current; that repo was abandoned with account
> termination warnings.

## Conventions

- **HAL-style JSON**: resources carry `_links` (rels to related resources; `self`,
  `next` for pagination) and may embed related entities in `_embedded`.
- **Client fingerprint headers** are sent with every request:
  `User-Agent: Strong Android`, `x-client-build: 600013`, `x-client-platform: android`
  (a combination verified against the live API). iOS fingerprint seen in the wild:
  `User-Agent: Strong iOS`, `x-client-version: 6.4.2`, `x-client-build: 8332`,
  `x-client-platform: ios`.
- **Errors**: non-2xx returns RFC 7807 problem+json:
  `{"type": "...rfc9110...", "title": "Unauthorized", "status": 401, "traceId": "..."}`.
  Under load/abuse the backend may instead return `Something went wrong. Please try
  again later.` with a 401/429 — treat it as a soft rate limit and back off.

## Endpoints

### Auth

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/auth/login` | — | Body `{usernameOrEmail, password, deviceId?}` → `{accessToken, refreshToken, expiresIn (s), userId}`. `deviceId` (uuid) is present in newer clients (iOS 6.4.2); reuse a stable one across logins/refreshes. |
| `POST` | `/auth/login/refresh` | — (no bearer) | Body `{accessToken, refreshToken, deviceId?}` → rotated `{accessToken, refreshToken, expiresIn}`. Rotates both tokens. |
| `GET` | `/api/users/{userId}` | Bearer | Main data endpoint. Query: `limit` (max per page, e.g. 200/500), `continuation` (opaque cursor), `include=log|measurement|tag|template|folder|widget|measuredValue|metric` (repeatable). Returns embedded collections + `_links.next` → follow it for more (pagination is **continuation-based**, not offset). |
| `GET` | `/api/users/{userId}/measurements` | Bearer | User's custom exercise definitions. |
| `GET` | `/api/users/{userId}/templates` | Bearer | Routine templates. |
| `GET` | `/api/users/{userId}/logs/{logId}` | Bearer | Single log detail. |
| `GET` | `/api/logs/{userId}` | Bearer | All logs for the user. |
| `PUT` | `/api/users/{userId}` | Bearer | **Write** path (opt-in, behind `--write`): send an envelope `{id: userId, strongAnalytics: false, _embedded: {log: [...], template: [...], ...}}` with changed entities (see jerhinesmith/strong-mcp for the full protocol). Used by `strong exercises create/rename/archive`. |
| `GET` | `/api/measurements?page=N` | **none** | **Public** — the global exercise definitions library (`253` total, `page`-based, 200/page). This powers `strong exercises` without auth. |

### Public resource list (from a user doc `_links`)

`folders`, `measurements`, `measuredValues`, `templates`, `metrics`, `metricCaches`,
`logs`, `tags`, `widgets` — each with a collection rel (+ `next` for pagination).

## Standard request shape (curl)

```bash
# login
curl -X POST https://back.strong.app/auth/login \
  -H "Content-Type: application/json" \
  -H "User-Agent: Strong Android" \
  -H "x-client-build: 600013" -H "x-client-platform: android" \
  -d '{"usernameOrEmail":"[EMAIL]","password":"..."}'

# authed GET (paginated logs)
curl -s "https://back.strong.app/api/users/{userId}?limit=200&continuation=&include=log" \
  -H "Authorization: Bearer $TOKEN" \
  -H "User-Agent: Strong Android" \
  -H "x-client-build: 600013" -H "x-client-platform: android"
```

## Notes / gotchas

- `include` values are singular resource names (`log`, not `logs`).
- Pagination cursor lives in `_links.next.href` — the `continuation` query param.
- `/api/measurements` ignores `continuation`; use `page`.
- Users' weight preferences are in `preferences.weightUnit[userId]` (`KILOGRAMS` /
  `POUNDS`); set weights in logs arrive in that unit (passthrough in this spike).