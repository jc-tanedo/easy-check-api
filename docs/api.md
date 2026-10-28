# API reference

[← Back to README](../README.md)

## Authentication at a glance

| Endpoint                                             | Authentication                                              |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| `/check-balance`, `/api/check-balance`               | `X-API-Key` plus personal credentials/defaults              |
| `/api/session`, `/api/balances`, `/api/transactions` | Browser cookie session                                      |
| `/api/balance-link`                                  | Browser session; mutations also require the expected Origin |
| `/bal/<key>`                                         | Private URL alone—treat it as a bearer secret               |

## External balance API

`GET` and `POST /check-balance` remain supported; `/api/check-balance` is an alias.
Every request requires `X-API-Key: <API_KEY>`. The dashboard does not use this
key: it uses cookie-authenticated endpoints.

### GET

Uses the optional server-side `DRIVEHUB_EMAIL` / `DRIVEHUB_PASSWORD` defaults:

```bash
curl 'http://localhost:7777/check-balance?id=123456789012' \
  -H "X-API-Key: $API_KEY"
```

| Parameter     | Behavior                                                                   |
| ------------- | -------------------------------------------------------------------------- |
| `accountType` | `primary` or `others`; defaults to `primary`                               |
| `page`        | Positive integer, default `1`                                              |
| `pageSize`    | Positive integer, default `20`, maximum `100`                              |
| `id`          | Optional 12-digit account number; searches linked accounts and later pages |

Without `id`, the response is one page. Unlinked accounts return 404. IMEI is no
longer used. Query-string credentials and invalid/ambiguous pagination are rejected.

### POST

Supply a complete personal email/password pair in an `application/json` body:

```json
{
    "email": "your-drivehub-email",
    "password": "your-drivehub-password",
    "accountType": "primary",
    "page": 1,
    "pageSize": 20
}
```

`id` is also accepted. Do not put credentials in URLs.

### Example response

```json
{
    "accounts": [{ "accountNo": "123456789012", "plateNo": "ABC1234", "balance": 123.45 }],
    "pagination": {
        "accountType": "primary",
        "page": 1,
        "pageSize": 20,
        "count": 1,
        "hasNext": false,
        "hasPrevious": false
    },
    "tokenExpiresAt": "2026-10-28 14:53:22",
    "tokenExpiresAtUtc": "2026-10-28T06:53:22.000Z"
}
```

ID lookups return one account with `pagination: null`. Account fields use
camelCase; retired `customerInfo` / `reloadInfo` structures are not synthesized.
Errors return `{ "error": "..." }` with an appropriate HTTP status.

The existing `jczr.dev` browser origins and subdomains retain machine-API CORS
access. Server-to-server requests do not require an Origin header.

## Transaction history

```http
GET /api/transactions?id=123456789012&accountType=primary
```

Uses the browser session. The server verifies linked-account ownership before
calling DriveHub's `GET /user-v2/user/rfid/trans?account_no=...`. The account
number is the signing input; token reuse/renewal follows the balance flow.

Choose **View transactions** in the dashboard to see timestamps, descriptions,
plates, amounts, and references. Date and time fields are displayed as supplied
by DriveHub, including seconds; no extra timezone shift is applied. Amounts
retain the upstream sign.

DriveHub's APK exposes no history pagination/date-range parameters. The dialog
shows only the returned records, not a guaranteed complete archive. Null lists
are treated as empty.

## Private balance URLs

While signed in, choose **Balance URL → Generate URL**. Copy or revoke it from
the same panel. Anyone holding it can read balances without cookies or the
machine API key; it cannot authenticate a browser session or read transactions.

| Request                       | Purpose                                      |
| ----------------------------- | -------------------------------------------- |
| `GET /api/balance-link`       | Retrieve the current session's link          |
| `POST /api/balance-link`      | Generate/reuse its link                      |
| `DELETE /api/balance-link`    | Revoke it                                    |
| `GET /bal/<12-character-key>` | Read the balance snapshot using only the URL |

### Lifecycle

- Keys are cryptographically random with collision checks. Repeated generation
  within a session returns the same URL; another session gets a different one.
- A snapshot includes all returned pages of primary and other accounts.
- Successful snapshots are cached for five minutes in Redis or process memory.
  Concurrent refreshes share one upstream fetch; query strings do not bypass it.
- `fetchedAt`, `cacheExpiresAt`, and `cached` describe snapshot freshness.
  `Cache-Control: no-store` prevents browser/proxy caching after revocation.
- Logout, session expiry, or explicit revocation makes the URL return 404 even
  if balances were cached. A new login does not revive it. A process restart
  invalidates memory-mode links; Redis-mode links survive normal restarts.
- In-flight refreshes cannot publish after invalidation. Failed credentials
  invalidate the session and return 404. Upstream outages return sanitized 502
  responses with `Retry-After` and a five-minute cooldown.

These URLs support direct navigation, same-origin browser use, and
server-to-server requests—not wildcard browser CORS. Set `APP_URL` behind a
reverse proxy so generated links use the public hostname.
