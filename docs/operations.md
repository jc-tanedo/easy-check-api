# Deployment & operations

[← Back to README](../README.md)

## Environment-only configuration

DriveHub application credentials come exclusively from `DRIVEHUB_APP_USERNAME`,
`DRIVEHUB_APP_PASSWORD`, and `DRIVEHUB_CLIENT_ID`. The old credential JSON file
and `DRIVEHUB_CLIENT_CONFIG` are no longer used. Personal credentials are entered
through the dashboard; optional machine-API defaults are separate.

Keep `.env` private (for example, `chmod 600 .env`). Do not prefix secrets with
`NEXT_PUBLIC_`. Environment files are ignored by Git and excluded from image
build contexts and standalone output. Legacy credential filenames remain
excluded as defense in depth; an old local file must not accidentally become
part of an image just because the application no longer reads it.

## Docker Compose

Follow the [quick start](../README.md#quick-start) to configure `.env` and copy
`docker-compose.example.yml` to `docker-compose.yml`. The example is tracked;
your local Compose file is ignored so deployment-specific changes stay local.
Do not overwrite an existing local Compose file when updating the example.

```bash
docker compose up -d --build
docker compose logs -f easycheck
docker compose down
```

The image uses Node.js 24, runs as the `node` user, and serves the frontend and API
on container port 7777. Compose loads credentials from `.env`; no file mounts
for application credentials are required.

Host publishing defaults to `127.0.0.1:${PORT:-7777}`. Use a host reverse proxy
for remote access. A proxy in another container needs a shared Docker network
and should connect to `easycheck:7777`. `BIND_HOST` applies only to the plain-Node
production launcher, not Compose port publishing.

After changing environment values:

```bash
docker compose up -d --force-recreate easycheck
```

The same built image can use different runtime configuration, including the
public `GITHUB_URL`. This URL must use HTTPS; empty or invalid values hide the
footer link. An unset value defaults to the project repository.

## HTTPS reverse proxy

Set the externally visible origin:

```dotenv
APP_URL=https://easy.example.com
```

This determines secure cookie behavior, the expected Origin for browser
mutations, and the hostname used in generated balance URLs. Use HTTPS when
transmitting credentials. Do not expose Redis publicly.

## Production Node.js

Requires Node.js 22.9 or newer:

```bash
npm ci
npm run build
npm start
```

The build creates a standalone Next.js server. The postbuild script copies static
assets and recursively removes environment and legacy credential files from the
output. `npm start` loads the root `.env` before starting the generated server.
`PORT` controls the listener; `BIND_HOST` defaults to `0.0.0.0`. Without `PORT`,
Next.js defaults to 3000; the example `.env` sets 7777.

For shared storage, set both `REDIS_URL` and a stable 64-hex-character
`SESSION_ENCRYPTION_KEY`. Without Redis, memory stores are deliberately volatile
and suitable only for a single process.

## Standalone Docker image

```bash
docker build -t easy-check .
docker run --rm -p 127.0.0.1:7777:7777 --env-file .env easy-check
```

This runs only the app. Supply a reachable `REDIS_URL` for persistence; otherwise
it runs in memory mode. A host-local Redis URL using `localhost` is not reachable
as localhost from inside the container. Compose handles networking automatically.

## Redis persistence & scaling

Compose includes Redis 7.4 on an internal backend network. Redis has no host port;
only the app also joins a network with outbound access to DriveHub. This is a
trusted single-host setup, not a high-availability or Redis Cluster deployment.
For remote Redis, use authentication, TLS (`rediss://`), and network restrictions.

| Setting    | Behavior                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------- |
| Storage    | `redis-data` named volume with AOF persistence                                           |
| Fsync      | `everysec`; abrupt host failure may lose about a second of writes, including revocations |
| Memory     | 256 MiB with `noeviction`; pressure returns errors rather than evicting sessions         |
| Encryption | AES-256-GCM credentials using `SESSION_ENCRYPTION_KEY`                                   |
| Outages    | Sanitized 503 responses; no fallback to local state                                      |
| Capacity   | Atomic caps of 1,000 sessions and 5,000 active login-limit identities                    |

Allow additional memory for Redis persistence overhead and the app. Back up the
volume and encryption key separately and protect both as sensitive data. The
key must be shared by all app replicas; never regenerate it on deployment.

- App/Redis restarts retain sessions and cached links with a stable key.
- `docker compose down` keeps the volume; **`down -v` destroys it**.
- Memory-only sessions cannot be imported when switching to Redis.
- Losing/changing the key makes existing sessions unreadable.

Multiple app instances share sessions, login limits, link ownership, cached
snapshots, and refresh leases. Leases are renewable and owner-checked: stale
workers cannot publish after logout, revocation, or lease loss. Waiting requests
return 503 if a refresh stays busy. Upstream app/user token caches remain
process-local; replicas may independently authenticate. Fully distributed token
coordination and serverless support are not claimed.

To scale Compose, replace the fixed host-port binding with a shared reverse
proxy/network so replicas do not compete for the same host port.

## Sessions & upstream renewal

- Sessions last at most 24 hours, without sliding expiry. Cookies are random,
  HTTP-only, SameSite=Strict, and Secure on HTTPS origins.
- Personal credentials are encrypted so expired upstream tokens can be renewed.
  Redis persists ciphertext with the shared key; memory mode uses an ephemeral
  process key. The app does not log plaintext credentials or return user tokens.
- Signing out deletes the session and disables its balance URL. It does not
  revoke the upstream DriveHub token.
- User tokens are reused until 30 seconds before absolute `exp_at`. Timezone-less
  expiry values are interpreted at UTC+08:00 unless
  `DRIVEHUB_EXPIRY_UTC_OFFSET` overrides it; explicit upstream offsets win.
- App authentication is renewed independently after 12 minutes. Concurrent
  requests for the same login share authentication. Early rejection retries
  renewed app authentication, then at most one user re-login.
- Failed browser sign-ins are limited to five per account per 15 minutes.
  Mutations check Origin; errors omit upstream response bodies and secrets.
- Dashboard refreshes fetch current balances directly; only generated balance
  URLs use the separate five-minute snapshot cache. Dashboard totals cover the
  current page, not necessarily all linked accounts.

## Testing with Redis

Use a disposable standalone Redis instance. Integration tests use unique
namespaces and clean up only their own keys:

```bash
docker run --rm -d --name easycheck-redis-tests \
  -p 127.0.0.1:16379:6379 redis:7.4-alpine
REDIS_TEST_URL=redis://127.0.0.1:16379 npm run test:redis
docker stop easycheck-redis-tests
```

To run browser tests against Redis, set `REDIS_URL` and a test-only
`SESSION_ENCRYPTION_KEY` when running `npm run test:e2e`. Never use production
Redis: browser tests use the standard application namespace. Browser tests run
the production standalone server with a test-only synthetic DriveHub adapter;
no personal account access is required.
