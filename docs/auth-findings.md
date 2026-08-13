# Strong API — Auth Findings

How authentication works on the undocumented Strong backend, and how `strong-cli`
implements it.

## Flow

```
POST /auth/login                         POST /auth/login/refresh
{ usernameOrEmail, password,             { accessToken, refreshToken,
  deviceId? }                              deviceId? }
        │                                          │
        ▼                                          ▼
{ accessToken: <JWT HS256>,              { accessToken: <new JWT>,
  refreshToken: <opaque>,                 refreshToken: <rotated>,
  expiresIn: 1200,                        expiresIn: 1200 }
  userId: <uuid> }
```

- **Access token** is a JWT (HS256) with `exp` (≈20 min, but the server returns
  `expiresIn: 1200`) and a WS-Federation-style `nameidentifier` claim holding the
  user id (`http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier`).
  `iss`/`aud` = `https://back.strong.app`.
- **Refresh token** is opaque base64; it **rotates** on every refresh. Send both current
  tokens to `/auth/login/refresh` (no Bearer header needed). Retrying with a rotated-out
  refresh token fails — persist the rotated pair atomically (before returning).
- **deviceId**: newer clients (iOS 6.4.2/build 8332, jerhinesmith/strong-mcp) send a
  stable random `deviceId` on login and refresh; older clients (Android build 600013,
  tolik518) omit it. It is treated as optional by the server. This CLI mints one on
  first login and reuses it.

## Token lifecycle in `strong-cli`

`TokenManager` (src/api/token-manager.ts, adapted from strong-mcp MIT):

1. Load session from store (env → config file → keyring; see below).
2. If `now ≥ expiresAt − 60s skew` → refresh **first** (proactive) via single in-flight
   promise so concurrent requests share one refresh call.
3. Decode the new JWT for the next `expiresAt`; fall back to `expiresIn` if undecodable.
4. `store.write(next)` **before** returning (crash-window minimized).
5. On any 401 mid-request: `forceRefresh()` once, retry the request once.

## Session storage (src/config/config.ts)

| Backend | When | Notes |
|---|---|---|
| Env vars `STRONG_ACCESS_TOKEN`/`STRONG_REFRESH_TOKEN` | CI/headless | Highest priority; store refuses to overwrite env-sourced sessions |
| Config file `~/.config/strong-cli/session.json` (0600) | `--use-config` | Preferred on read over the keyring; refresh writes stay in the file — headless-safe, no D-Bus needed |
| OS keyring (keytar) | default `auth login` | macOS Keychain / Windows Credential Manager / Linux Secret Service. Skipped on Linux when no D-Bus session bus is present (avoids libsecret's `Cannot autolaunch D-Bus without X11 $DISPLAY` failure); on read it is only consulted when there is no config-file session |

## Risks

- **Unofficial/undocumented**: endpoints, fingerprints (`x-client-build`), and token
  formats can change without notice. The env overrides (`STRONG_BACKEND`,
  `STRONG_CLIENT_BUILD`, `STRONG_CLIENT_PLATFORM`) exist for that day.
- **Account termination**: the community's earlier Parse-based API work
  (dmzoneill/strongapp-api) resulted in explicit termination threats from Strong. Keep
  usage personal, read-only, low-frequency. Writes are opt-in behind an explicit
  `--write` flag and should only ever target a disposable test account.
- **Soft rate limiting observed** (2026-08): several rapid bad logins started returning
  `{"Something went wrong. Please try again later."}` with HTTP 401 instead of the
  RFC 7807 body — a generic anti-abuse response. The client maps 401s to a clean
  `AuthError`, but don't script login retries in a tight loop.
- **Multi-device**: the API allows multiple sessions/devices; logging in via CLI does
  not invalidate the phone app session.