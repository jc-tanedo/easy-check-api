# EasyCheck

A single Next.js application for your DriveHub RFID balances: sign in, see linked
accounts, switch between primary and other accounts, and refresh before a trip.
The existing dashboard API is served by the same application.

The old `easy-ui-2` Nuxt repository is a reference only; it is not a deployment
dependency. Express, the retired Easytrip endpoint, IMEI generation, and Rijndael
encryption have been replaced by Next.js route handlers and DriveHub's signed API.
Axios and Lodash are retained.

## Project structure

```text
app/                    Next.js routes, dashboard components, and React hooks
lib/client/             Browser API error helpers
lib/shared/             Runtime-neutral formatting helpers
lib/server/             Configuration, crypto, sessions, handlers, and HTTP responses
lib/server/drivehub/    DriveHub service, transport, expiry, and response validation
types/                  Shared domain contracts
test/                   ESM unit tests and typed fixtures
test/e2e/               Playwright specs and synthetic DriveHub preload
scripts/                Plain-Node development, startup, and packaging tools
docs/                   Quality baseline and verification history
```

Use kebab-case filenames, `use-` prefixes for React hooks, `.tsx` for components,
`.test.mts` for ESM unit tests, and `.spec.ts` for browser tests. Keep Next.js's
reserved route filenames (`page.tsx`, `layout.tsx`, `route.ts`) unchanged.
Server implementation belongs in `lib/server`; browser code must not import it.
Runtime-neutral helpers belong in `lib/shared`, and browser-specific helpers in
`lib/client`. Prefer descriptive module filenames such as `service.ts`,
`transport.ts`, and `responses.ts` over generic barrels or utility buckets.

## Local setup

Requires Node.js 22.9 or newer. The Docker image uses Node.js 24.

```bash
npm ci
cp .env.example .env
```

Skip the copy if `.env` already exists. Set `API_KEY` to a random value of at least
32 characters; it authenticates external API consumers and is never sent to the UI.
Generate a key with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

App client credentials are loaded from the ignored `.drivehub-client.json` in the
repository root, or `DRIVEHUB_CLIENT_CONFIG`. It must be a regular JSON file no
larger than 16 KiB; `username`, `password`, and `client_id` may be provided as
string fields. Store it with restrictive permissions (for example, `chmod 600`).
These are the app client credentials from the PoC, separate from
your personal DriveHub login. The existing local credential file is preserved.
Other deployments need their own copy or these environment variables instead:

```text
DRIVEHUB_APP_USERNAME=...
DRIVEHUB_APP_PASSWORD=...
DRIVEHUB_CLIENT_ID=...
```

Do not prefix secrets with `NEXT_PUBLIC_`. Both `.env` and the app client file are
ignored by Git, excluded from Docker build contexts, and excluded from standalone
file tracing.

```bash
npm run dev
```

Open `http://localhost:7777` when using the example `.env`. Next.js defaults to
port 3000 if `PORT` is unset. Sign in with your personal DriveHub email/password.
No API key needs to be entered in the browser.

## Production on Node.js

```bash
npm ci
npm run build
npm start
```

The build produces a standalone Next.js server; its static assets are copied by
the `postbuild` script. Packaging removes dotenv and credential files recursively
from the standalone output; provide runtime secrets through environment variables
or a read-only credential-file mount instead. `npm start` loads `.env` and resolves the app credential
file before starting that server. `PORT` controls the port and `BIND_HOST` controls
the bind address, defaulting to `0.0.0.0`.

For remote deployment behind an HTTPS reverse proxy, set the public origin:

```text
APP_URL=https://easy.example.com
```

This enables secure session cookies and defines the allowed origin for browser
sign-in/sign-out requests. Use HTTPS when transmitting account credentials.

## Docker

```bash
docker build -t easy-check .
docker run --rm -p 7777:7777 --env-file .env \
  -v "$PWD/.drivehub-client.json:/app/.drivehub-client.json:ro" \
  easy-check
```

The multi-stage image contains the standalone server and static assets and runs
as the `node` user. The runtime user must be able to read the mounted credential
file. The mount can be omitted when app credentials are environment variables.
The frontend and API share one port and deployment; no separate web server is
needed for the frontend.

## Browser sessions and token renewal

- Browser sessions use a random HTTP-only, SameSite=Strict cookie. HTTPS origins
  get Secure cookies. Neither the machine API key nor the DriveHub user token is
  returned to frontend code.
- Submitted personal credentials are encrypted in process memory using an
  ephemeral key, so the service can log in again after a DriveHub token expires.
  They are never written to disk or logged by the application.
- Browser sessions last at most 24 hours. Signing out deletes the local session;
  it does not revoke the upstream DriveHub token. Process restarts lose all
  sessions and require signing in again.
- User tokens are reused until 30 seconds before the returned absolute `exp_at`.
  A date such as `2026-10-28 14:53:22` is interpreted as Philippine time, UTC+08:00.
  `DRIVEHUB_EXPIRY_UTC_OFFSET` overrides this assumption. Explicit offsets from
  DriveHub take precedence. No six-hour duration is hardcoded.
- App authentication is renewed independently after 12 minutes. Concurrent logins
  for the same credentials share a request. Early user-token rejection triggers
  at most one re-login after retrying with renewed app authentication.
- Failed browser sign-ins are limited to five attempts per account in 15 minutes.
  Session mutations require the expected Origin header. Errors omit upstream
  response bodies, tokens, and submitted passwords.
- Dashboard refresh requests fetch balance data directly. Generated balance URLs
  use a separate five-minute cache.
  The displayed total covers the accounts on the current page.

This implementation targets one long-running Node process or Docker container.
Session and token caches are in memory, with bounded sizes. Multiple replicas or
serverless deployment would need a shared session/cache store before use.

## Transaction history

Choose **View transactions** on an RFID account to load its history. The dialog
shows the date/time, type, description, plate, amount, and reference number. Date and clock-time fields are displayed as supplied by DriveHub, which already
returns Philippine local time. The UI does not apply an additional timezone shift. Amounts retain the
sign returned by DriveHub.

`GET /api/transactions?id=123456789012&accountType=primary` uses the existing
browser session. The server verifies linked-account ownership before calling
`GET /user-v2/user/rfid/trans?account_no=...`. The account number is the HMAC input;
user token reuse and renewal follow the balance flow. No credentials are exposed
to the browser.

The APK exposes no history pagination or date-range parameters. The dialog shows
only the records returned by DriveHub; it does not claim to include all historical
transactions. Null history lists are treated as empty, matching the app.

## Session-bound balance URLs

While signed in, open **Balance URL** and choose **Generate URL**. The panel can
copy the URL or revoke it. Anyone holding that private URL can fetch its balance
JSON without cookies or the machine API key. It grants balance access only; it
cannot be used as a browser session or to read transaction history.

- URLs use `/bal/<key>` with a cryptographically random 12-character key and a
  collision check. A URL belongs to the login session that generated it. Repeated generation in
  that session returns the same URL. Other sessions get different URLs.
- It returns all pages of primary and other linked accounts under `accounts`.
- A successful snapshot is cached in server memory for five minutes. Requests
  during that window share it, and concurrent refreshes share one upstream fetch.
  Query-string cache-busting does not bypass this cache.
- JSON includes `fetchedAt`, `cacheExpiresAt`, and `cached` so consumers can tell
  when the snapshot was retrieved. HTTP `Cache-Control: no-store` prevents a
  browser or proxy cache from serving data after session revocation.
- Logout, session expiry, server restart, or explicit revocation makes the URL
  return 404, including when a snapshot was cached. Logging in again does not
  restore the old URL. In-flight refreshes also check the session before returning
  account data.
- Upstream failures return 502 and a `Retry-After` header, with a five-minute
  cooldown. Failed credentials invalidate the session and return 404.
- These URLs support direct access, same-origin browser requests, and
  server-to-server integrations. They do not enable wildcard browser CORS.

`GET /api/balance-link` retrieves the current URL, `POST` generates it, and `DELETE`
revokes it. These management endpoints require the browser session; mutations
require the expected Origin. The generated `GET /bal/<12-character-key>`
endpoint requires only the private URL. Set `APP_URL` to your public origin when
hosting behind a reverse proxy so generated URLs use the correct hostname.

## External dashboard API

`GET` and `POST /check-balance` remain available. `/api/check-balance` is an alias.
All requests require `X-API-Key: <API_KEY>`; the browser UI uses separate cookie
endpoints (`/api/session` and `/api/balances`).

GET uses optional `DRIVEHUB_EMAIL` / `DRIVEHUB_PASSWORD` defaults from the server:

```bash
curl 'http://localhost:7777/check-balance?id=123456789012' \
  -H "X-API-Key: $API_KEY"
```

Without `id`, it returns a page of accounts. Supported parameters are
`accountType=primary|others`, `page=1`, and `pageSize=20` (maximum 100). With `id`,
the service searches your linked accounts and subsequent pages. The ID must be a
12-digit account number; unlinked accounts return 404. IMEI is no longer used.

POST accepts a complete email/password pair in an `application/json` body:

```json
{
    "email": "your-drivehub-email",
    "password": "your-drivehub-password",
    "accountType": "primary",
    "page": 1,
    "pageSize": 20
}
```

`id` is also accepted. Query-string credentials and ambiguous/invalid pagination
are rejected. Existing `jczr.dev` browser origins and subdomains retain CORS
access to the machine API; server-to-server requests work without an Origin.

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

ID lookups return one account and `pagination: null`. Account fields are converted
to camelCase. The retired API's `customerInfo` / `reloadInfo` structures are not
synthesized. Errors return `{ "error": "..." }` with a suitable HTTP status.

## Tests

```bash
npm test
npm run type-check
npm run lint
npm run format:check
npm run build
npx playwright install chromium
npm run test:e2e
```

To use an existing Chromium installation:

```bash
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

Unit/integration tests cover signing, absolute expiry, renewal, pagination,
cookie sessions, encrypted credential storage, CSRF, rate limits, and sanitized
errors. Browser tests run the production standalone server with an explicitly
test-only synthetic DriveHub adapter; they exercise desktop/mobile sign-in,
account switching, refresh/retry, session restoration, sign-out, and both machine
API paths. They do not access personal accounts.
