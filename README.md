<div align="center">

# EasyCheck

**Your RFID balances. One clear dashboard.**

Check linked DriveHub accounts, review transactions, and share a private balance URL—without opening another app.

![Node.js 22.9+](https://img.shields.io/badge/Node.js-22.9%2B-43853d?logo=nodedotjs&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7.4-dc382d?logo=redis&logoColor=white)

[Quick start](#quick-start) · [Configuration](#configuration) · [Deployment](docs/operations.md) · [API reference](docs/api.md) · [Development](#development)

</div>

---

## At a glance

|                          | What you get                                                                 |
| ------------------------ | ---------------------------------------------------------------------------- |
| **Linked balances**      | Primary and other RFID accounts, pagination, and on-demand refresh.          |
| **Transaction history**  | A mobile-friendly timeline with timestamps, plates, amounts, and references. |
| **Private balance URLs** | Cookie-free balance JSON with a five-minute cache and explicit revocation.   |
| **Persistent sessions**  | Encrypted credentials and shared browser state through Redis.                |
| **One deployment**       | Dashboard and API in a single Next.js app, with Docker Compose included.     |

> [!NOTE]
> EasyCheck is an unofficial integration, not affiliated with DriveHub. You need
> DriveHub **application credentials** to run it; your personal login alone is not enough.

## Quick start

### 1. Prepare your environment

Requires **Docker with Compose**. For local development, use **Node.js 22.9+** instead.

```bash
git clone https://github.com/jc-tanedo/easy-check-api.git
cd easy-check-api
cp .env.example .env
cp docker-compose.example.yml docker-compose.yml
```

Skip either copy if the destination already exists. `.env` and
`docker-compose.yml` are local, Git-ignored configuration files; the tracked
examples provide the starting point.

### 2. Add your credentials

Edit `.env` and fill in these five values:

```dotenv
API_KEY=<random-secret-at-least-32-characters>
SESSION_ENCRYPTION_KEY=<separate-64-character-hex-secret>
DRIVEHUB_APP_USERNAME=<application-username>
DRIVEHUB_APP_PASSWORD=<application-password>
DRIVEHUB_CLIENT_ID=<application-client-id>
```

Generate a random secret with the command below. **Run it twice**: once for
`API_KEY`, and again for a separate `SESSION_ENCRYPTION_KEY`.

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

No Node.js installed? Use `docker run --rm node:24-alpine node -e` with the same
quoted JavaScript expression.

> [!IMPORTANT]
> Keep `SESSION_ENCRYPTION_KEY` stable and backed up. Changing or losing it makes
> existing Redis sessions unreadable. Never commit `.env` or share these secrets.

### 3. Start EasyCheck

```bash
docker compose up -d --build
```

Open **[localhost:7777](http://localhost:7777)** and sign in with your **personal
DriveHub email and password**. No API key is entered in the dashboard.

Compose starts the app and a private, persistent Redis service. The app binds to
localhost by default; use an HTTPS reverse proxy for remote access.

<details>
<summary><strong>Prefer running locally without Docker?</strong></summary>

After configuring `.env`:

```bash
npm ci
npm run dev
```

Open `http://localhost:7777`. Without `REDIS_URL`, sessions and balance links stay
in memory and are lost when the process restarts. `SESSION_ENCRYPTION_KEY` is
required only when Redis is enabled.

For a production Node deployment, run `npm run build` followed by `npm start`.
See [deployment and operations](docs/operations.md) for standalone Docker and Redis setup.

</details>

## Configuration

**Environment variables are the only credential source.** Use `.env` with the
Node launchers or Compose; other deployments can inject variables directly.
No credential JSON file or secret-file mount is needed.

### Required

| Variable                 | Purpose                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `API_KEY`                | Authenticates external API consumers; at least 32 characters. Never sent to the dashboard. |
| `DRIVEHUB_APP_USERNAME`  | DriveHub application username, not your personal email.                                    |
| `DRIVEHUB_APP_PASSWORD`  | DriveHub application password.                                                             |
| `DRIVEHUB_CLIENT_ID`     | DriveHub application client identifier.                                                    |
| `SESSION_ENCRYPTION_KEY` | 64 hex characters; required for Compose and any Redis-enabled deployment.                  |

### Optional

| Variable                              | Default / behavior                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `PORT`                                | Example: `7777`; Compose uses it as the host port.                                         |
| `APP_URL`                             | Public origin, such as `https://easy.example.com`; set behind a reverse proxy.             |
| `GITHUB_URL`                          | This repository’s HTTPS URL. Set empty to hide the footer link.                            |
| `REDIS_URL`                           | Unset: memory mode. Compose supplies its private Redis URL automatically.                  |
| `BIND_HOST`                           | `0.0.0.0` for the production Node launcher; does not control Compose publishing.           |
| `DOCKER_BIND_HOST`                    | `127.0.0.1` for Compose. Set `0.0.0.0` only if direct exposure is intended.                |
| `DRIVEHUB_EMAIL`, `DRIVEHUB_PASSWORD` | Personal account defaults for machine-API GET requests only. Not needed for browser login. |
| `DRIVEHUB_EXPIRY_UTC_OFFSET`          | `+08:00` for upstream token expiries without an explicit timezone.                         |

Changes require a process restart, **not an image rebuild**. For Compose:

```bash
docker compose up -d --force-recreate easycheck
```

<details>
<summary><strong>Upgrading from the old JSON credential setup?</strong></summary>

Move `username`, `password`, and `client_id` from your old credential file into
`DRIVEHUB_APP_USERNAME`, `DRIVEHUB_APP_PASSWORD`, and `DRIVEHUB_CLIENT_ID` in `.env`.
Remove any `DRIVEHUB_CLIENT_CONFIG` setting. JSON credential loading is no longer
supported. Existing local files are not deleted, but are ignored by the app.

Build the updated app once with `docker compose up -d --build`. Subsequent
credential changes need only a container recreation.

</details>

## Security & behavior

- **24-hour sessions:** HTTP-only, SameSite=Strict cookies; Secure cookies on HTTPS.
- **Encrypted credentials:** AES-256-GCM, with a stable shared key when using Redis.
- **Immediate invalidation:** logout or revocation disables a balance URL, including cached data.
- **Session-bound links:** a new login does not restore an old balance URL. Anyone with an active URL can read its balances—treat it as a secret.
- **Automatic renewal:** upstream tokens are refreshed as needed; no token is exposed to frontend code.
- **Fail-closed storage:** configured Redis outages return sanitized 503 responses, never a memory fallback.

> [!WARNING]
> `docker compose down` preserves Redis data. **`docker compose down -v` deletes
> it**, invalidating sessions and balance URLs. Redis persistence is not a backup.

See [operations](docs/operations.md) for persistence limits, reverse proxies,
scaling, rate limits, and key management.

## Development

```bash
npm ci
npm run dev
```

### Checks

```bash
npm test
npm run type-check
npm run lint
npm run format:check
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser tests use synthetic DriveHub responses, not personal accounts. For a
system Chromium installation, use `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`.
Real-Redis test commands and safety notes are in [operations](docs/operations.md#testing-with-redis).

<details>
<summary><strong>Project layout & conventions</strong></summary>

```text
app/                    Routes, dashboard components, and React hooks
lib/client/             Browser API error helpers
lib/shared/             Runtime-neutral formatting
lib/server/             Configuration, stores, sessions, and handlers
lib/server/drivehub/     Signing, transport, token renewal, and validation
types/                  Shared domain contracts
test/                   Unit tests and typed fixtures
  e2e/                  Playwright specs and synthetic DriveHub adapter
  integration/          Real-Redis lifecycle and concurrency tests
scripts/                Development, startup, and packaging tools
docs/                   API reference, operations, and quality history
```

Use kebab-case filenames, `use-` prefixes for hooks, `.tsx` for components,
`.test.mts` for unit tests, and `.spec.ts` for browser tests. Keep Next.js reserved
route names unchanged. Browser code must not import `lib/server`.

</details>

## Further reading

- [API reference](docs/api.md) — machine API, transaction history, and balance URLs
- [Deployment & operations](docs/operations.md) — Docker, Node, Redis, and security
- [Quality baseline](docs/quality-baseline.md) — migration decisions and verification history

The older Nuxt UI and retired Easytrip API are not deployment dependencies.
