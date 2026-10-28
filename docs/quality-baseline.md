# Code quality and migration baseline

## Status and scope

**Plan status: completed.** All 18 steps and the subsequent review findings and
folder/naming cleanup are complete. Implementation was committed as `28fb45b`
(`Refactor EasyCheck into a strictly typed Next.js application`).

Final cleanup verification passed strict type-check, lint, formatting, all 60
unit tests, all 16 E2E tests, production build, and diff checks. Live DriveHub
verification and coverage measurement remain outside the completed scope; the
limitations below are retained rather than implied to be verified.

Plan step 1 established the review baseline. Steps 2–18 have since been
implemented incrementally as described below. The post-plan review follow-up
also closes the test-typing, frontend hook, and migration-configuration gaps.
Historical results below are retained as a record, not as current status; see
“Review findings closeout” for the latest checks and remaining limitations.

Recorded on 2026-10-28 (UTC), before formatting, linting, refactoring, or TypeScript migration.
The baseline is the **current working tree**, not the committed legacy implementation.
HEAD was `07451ea6ca209263411eb37d2c4162452d0906a5`.
No commit, staging, reset, dependency installation, or application-code change was performed.

The pre-existing working tree contained:

- Modified tracked files: `.gitignore`, `Dockerfile`, `README.md`, `config.js`,
  `package-lock.json`, `package.json`, `service/easytrip/index.js`, and `utils/crypto.js`.
- Deleted tracked files: `controllers/easytrip.js` and `server.js`.
- Untracked implementation/configuration: `.dockerignore`, `.env.example`, `AGENTS.md`,
  `app/`, `lib/`, `next.config.js`, `playwright.config.js`, `scripts/`,
  `service/easytrip/expiry.js`, `service/easytrip/http.js`, and `test/`.

Those changes were preserved. This document is the only source-tree addition for step 1.
Build and test runs regenerated ignored `.next/` and `test-results/` artifacts.
Local credential values are intentionally excluded from this record.

## Environment

| Item              | Observed value                     |
| ----------------- | ---------------------------------- |
| Node.js           | 26.12.0                            |
| npm               | 11.20.0                            |
| Chromium          | 156.0.8078.47, `/usr/bin/chromium` |
| Next.js           | 16.4.3                             |
| React / React DOM | 19.3.1                             |
| Playwright        | 1.64.1                             |
| Axios             | 1.21.0                             |
| Cookie            | 1.1.1                              |
| Lodash            | 4.18.1                             |
| Lucide React      | 1.62.0                             |

`npm ls --depth=0` completed successfully using existing dependencies.
These results do not establish compatibility with the declared Node.js minimum
(`>=22.9.0`) or the Docker image's Node.js 24 runtime; those need separate checks.

## Implementation inventory

- `app/`: client dashboard, balance-link panel, transaction-history dialog,
  layout/styles, and thin Next.js route adapters.
- `lib/server/`: HTTP handlers, input parsing, runtime composition, encrypted
  in-memory sessions, login limiting, and session-bound balance links.
- `service/easytrip/`: DriveHub HTTP transport, expiry parsing, authentication,
  token renewal, account lookup, and transaction retrieval. The directory retains
  its legacy name.
- `config.js`, `utils/crypto.js`: runtime configuration and signing/secret comparison.
- `scripts/`, `next.config.js`, `Dockerfile`: development, standalone packaging,
  production startup, and container deployment.
- `test/`: Node unit/integration/packaging tests and Playwright browser tests.

The browser tests preload `test/e2e/mock-drivehub.cjs` into the standalone server.
It uses synthetic credentials/data, directly requires CommonJS source modules,
requires `EASYCHECK_E2E=1`, and populates the shared runtime symbol. Preserve this
isolation when migrating module formats and test execution.

## Historical baseline checks

Run from the repository root:

| Command                                            | Result                                                  |
| -------------------------------------------------- | ------------------------------------------------------- |
| `npm test`                                         | PASS: 54 tests, 0 failures, 0 skipped                   |
| `NEXT_TELEMETRY_DISABLED=1 npm run build`          | PASS: webpack production build and standalone postbuild |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` | FAIL: 11 passed, 2 failed, 13 total                     |

The production build generated the home page, framework not-found page, icon,
`/api/session`, `/api/balances`, `/api/transactions`, `/api/balance-link`,
`/api/check-balance`, `/check-balance`, and `/bal/[token]`.
It loaded the existing `.env`; no credential values were recorded here.

The build's “Running TypeScript” output is not evidence of a strict TypeScript
baseline: at that point there was no project TypeScript configuration or migration.
At the initial baseline, no lint, formatting, or explicit type-check
script/configuration existed. Step 2 added ESLint 9 flat config with the
Next.js 16.4.3 Core Web Vitals preset, Prettier 3, `eslint-config-prettier`,
`.editorconfig`, and `lint`, `lint:fix`, `format`, and `format:check` scripts.
The Next navigation lint error was fixed by using `next/link`. The async
transaction-history effect has a narrowly scoped explanatory suppression for
React's synchronous-effect-state rule; its updates follow network completion.
At step 2, `npm run lint` exited successfully with one request-counter cleanup
warning at `app/page.js:135`. That code was subsequently migrated and extracted
into typed request hooks; current lint has no warnings. Formatting passed.
A clean `npm ci`, Docker build, coverage measurement, and live DriveHub account
verification had not been performed at the initial baseline (Docker builds and
clean installs were subsequently verified in step 17). `npm audit --omit=dev` reported zero
production dependency vulnerabilities at the time of this review.

### Existing browser failure 1: timeline details

- Test: `transaction timeline stays bounded and scrolls independently with all details visible`.
- Location: `test/e2e/dashboard.spec.js:153`, failing assertion at line 170.
- Expected exact visible text: `1:15 AM`.
- The transaction clock formatter in `app/components/transaction-history.js`
  explicitly includes `second: '2-digit'`, producing `1:15:00 AM`.
- This failure stops the test before its subsequent desktop/mobile layout and
  scrolling assertions; those assertions are not verified by this baseline run.
- Artifacts: `test-results/dashboard-transaction-time-8f2a3-ly-with-all-details-visible/`.

### Existing browser failure 2: wall-clock timestamps

- Test: `transaction wall-clock timestamps › preserves supplied local dates and times without applying another offset`.
- Location: `test/e2e/dashboard.spec.js:242`, failing assertion at line 261.
- Expected: `1:15 AM`; received: `1:15:00 AM`.
- This is the same seconds-versus-minutes presentation mismatch. The failure does
  not, by itself, demonstrate a timezone-shift bug.
- The first record fails, so later timestamp cases are not verified by this run.
- Artifacts: `test-results/dashboard-transaction-wall-6d3ff-out-applying-another-offset/`.

These two assertions failed in the recorded baseline because the test expected
minute precision while the implementation emitted seconds. The UI owner later
confirmed seconds are intended, and the assertions were updated accordingly;
the full E2E suite now passes without weakening timezone or layout coverage.

## Review findings to carry forward

1. Add ESLint flat configuration, Prettier, EditorConfig, and explicit scripts;
   Next.js 16 requires the ESLint CLI rather than `next lint`.
2. Broaden Git secret exclusions for conventional `.env.*` files while retaining
   the example file.
3. Validate upstream records at runtime, not just container shapes; TypeScript
   does not validate external JSON.
4. Split oversized frontend orchestration and server handler responsibilities.
5. Consolidate shared validation, money formatting/parsing, session-expiry/error
   handling, and bounded pagination where semantics truly match.
6. Separate local application errors from upstream errors; local capacity `503`
   currently becomes `502` through handler error mapping.
7. Propagate the injected handler clock into default session/limiter instances.
8. Make CommonJS/ESM and test-loader boundaries explicit before TypeScript conversion.
9. Preserve authentication signing, renewal/coalescing, account ownership, CSRF,
   encrypted storage, link revocation, and secret-free packaging behavior.
10. Reconcile documented configuration defaults with launcher/runtime behavior,
    including port selection and credential-file paths.

## Reference fingerprints

SHA-256 of selected baseline inputs (not a complete working-tree snapshot):

```text
68b360cab31fe3ce38a638022559234d8e8bd6d3d3745bf5b4e2599992c96064  package.json
85fb0753632ba95274d4391a5a61c4d51066370ef73ff271a00f2d9588e21842  package-lock.json
f8c7775a0625c9c880baadf3a3788c8b8bb6cdb87a227ea97e5983f3abbb7c58  app/components/transaction-history.js
12f4b94f4292a19165921ad61f4f408e867d3b32f76c96dd0055f541f7b1c842  test/e2e/dashboard.spec.js
```

## Quality tooling follow-up (plan step 2)

Added files: `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, and
`.editorconfig`. Added ESLint/Next/Prettier development dependencies and the
scripts listed above. Git now ignores `.env.*` while explicitly allowing
`.env.example`. Prettier was run across tracked and untracked source/docs files;
format-only churn is intentional for this step. The small `next/link` change
satisfies Next's internal navigation rule. Hook dependency warnings in both
panels were fixed; one intentional stale-request counter warning remains.

After formatting and tooling changes, `npm test` still passes all 54 tests,
`npm run build` passes, `npm run format:check` passes, and `npm run lint` exits 0
with one warning. Playwright was rerun: 11 passed, 2 failed. The failures are the
same two seconds-versus-minutes timestamp assertions recorded above; all other
11 browser tests still pass.

## Regression tests added (plan step 3)

Added focused regression assertions in `test/handlers.test.js` and
`test/service.test.js` for four review findings:

1. Default sessions should derive expiry from the handler's injected clock.
2. Local session-capacity errors should preserve HTTP `503`, rather than being
   reported as upstream `502`.
3. Malformed individual RFID account records should be rejected at the service
   boundary.
4. Malformed individual transaction records should be rejected at the service
   boundary.

Initially, the four added tests failed for the intended reasons: the session
store used real time, local `503` was mapped to `502`, and account/transaction
array entries were not validated. These drove the fixes in steps 4 and 5. All
four now pass, and the full suite has increased from 54 to 58 passing Node
tests.

Clock-expiry and local error mapping were corrected with the response
validation. The post-plan follow-up adds focused UI request-lifecycle tests for
logout and account switching during delayed balance requests, plus stable
transaction fetching across parent renders. Timestamp E2E assertions now
reflect the owner's confirmed seconds-precision display.

## Work completed through TypeScript migration steps 10–17

- **Step 4 — contracts and validation:** added `types/domain.ts` and
  `service/easytrip/schema.ts`. Upstream account and transaction arrays now
  reject null, scalar, or array entries before exposing them; valid records are
  normalized through one helper. Added a runtime object-shape guard for local
  DriveHub client configuration.
- **Step 5 — server responsibilities:** extracted bounded JSON parsing, safe
  JSON response construction, and error mapping into `lib/server/http.ts`.
  Default session and login-limiter instances now receive the handler clock.
  Local session-capacity `503` errors are distinguished from upstream errors.
- **Step 6 — frontend structure:** extracted the account presentation into the
  strictly typed `app/components/account-card.tsx`; shared PHP formatting and
  tolerant numeric parsing now live in `app/lib/format.ts`. Existing transaction
  and balance-link effect callbacks are typed/stabilized; shared Axios failure
  narrowing lives in `app/lib/api-error.ts`.
- **Step 7 — TypeScript foundation:** added strict `tsconfig.json`, workspace
  TypeScript and React/Node/Lodash types, `tsx` for CommonJS test/preload
  interop, and a `type-check` script (`next typegen && tsc --noEmit`). JavaScript
  was allowed during migration; `allowJs` is now false.
- **Step 8 — dependency-order migration:** migrated configuration, crypto,
  expiry, transport, validation, service, HTTP/session handlers, caches, runtime,
  route handlers, layout, page, UI components, and the guarded synthetic
  DriveHub preload to TypeScript. Only operational Node launcher scripts remain
  CommonJS.
- **Step 9 — shared contracts and validation:** typed `AppConfig`, credentials,
  account, transaction, pagination, and token metadata; moved crypto, expiry,
  config, and runtime response guards to `.ts` files. Credential-file JSON is
  bounded and validated for object shape and string-valued credential fields.
- **Step 10 — DriveHub transport/service:** migrated Axios transport and service
  orchestration to TypeScript, including typed request boundaries, `unknown`
  response parsing, bounded account/transaction record checks, and safe status
  narrowing. The service keeps the existing user/app token renewal, signing,
  pagination, and account ownership behavior.
- **Steps 11–12 — sessions/cache/handlers:** migrated encrypted sessions, login
  limiter, balance-link cache, input parsing, HTTP helpers, handler composition,
  and runtime singleton to TypeScript. All generated URL ownership, expiry,
  revocation, caching, cooldown, and in-flight invalidation tests remain green.
- **Steps 13–14 — Next routes and UI:** migrated every route handler, root layout,
  dashboard page, account card, balance-link panel, and transaction-history
  dialog to TypeScript/TSX. Added typed API DTO use, narrowed Axios failures,
  typed React state/refs/events, and consolidated currency parsing/formatting.
- **Step 15 — tests:** migrated Node unit/integration tests to ESM `.mts` so
  Node 22.9 can load TypeScript application modules through `tsx` without relying
  on newer native `require(typescript)` support. Migrated the Playwright spec,
  config, and guarded synthetic preload to TypeScript. All test sources and
  injected fixtures now pass strict `tsc` without test-source exclusions,
  blanket casts, `any` annotations, or disabled strictness.
- **Step 16 — configuration/tooling:** migrated `next.config.js` to
  `next.config.ts`. The three Node launcher scripts (`dev`, `start`, and
  standalone packaging) remain JavaScript intentionally because deployed startup
  uses plain Node and must not depend on a development-only TS runtime.
- **Step 17 — packaging and compatibility:** credential files must be regular
  files under 16 KiB with optional string fields. Standalone cleanup recursively
  removes dotenv/credential files; Git and Docker secret exclusions have
  regression coverage. Validated Node 22.9 and Node 24 builds/runtime.

Verification after these changes:

| Check                                                                         | Result                                                   |
| ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| `npm run type-check`                                                          | PASS                                                     |
| `npm run lint`                                                                | PASS                                                     |
| `npm run format:check`                                                        | PASS                                                     |
| `npm test`                                                                    | PASS: 60 tests                                           |
| `npm run build`                                                               | PASS                                                     |
| Docker build on Node 22.9 (type-check, lint, tests, build, E2E preload smoke) | PASS: Node 22.9.0; 60 tests                              |
| Docker build on Node 24 + runtime smoke test                                  | PASS: dashboard served; no secret files in runtime image |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`                            | PASS: 13 tests                                           |

The E2E test preload order matters: use `--import tsx --import ./test/e2e/mock-drivehub.mts`; the preload imports the guarded synthetic adapter before the standalone Next server starts.

## Final verification and closeout (plan step 18)

All listed checks were rerun against the current working tree. Results:

| Check                                                                           | Result                                                     |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `npm run type-check`                                                            | PASS                                                       |
| `npm run lint`                                                                  | PASS                                                       |
| `npm run format:check`                                                          | PASS                                                       |
| `npm test`                                                                      | PASS: 60 tests                                             |
| `npm run build`                                                                 | PASS                                                       |
| `npm audit --omit=dev`                                                          | PASS: zero production vulnerabilities                      |
| `git diff --check`                                                              | PASS                                                       |
| Node 22.9 Docker: type-check, lint, tests, build, standalone + TS preload smoke | PASS                                                       |
| Node 24 Docker build and runtime image smoke                                    | PASS; dashboard served, no dotenv/credential files present |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`                              | PASS: 13 tests                                             |

At the first step-18 closeout, test sources were excluded from strict `tsc`
and frontend request hooks were still outstanding. The review correctly flagged
those as incomplete against the original plan; both are implemented below.

## Folder and naming cleanup

Following the review closeout, implementation files were consolidated without
changing route URLs or runtime behavior:

- `config.ts` and `utils/crypto.ts` moved to `lib/server/`.
- `service/easytrip/` became `lib/server/drivehub/`; its `index.ts` and `http.ts`
  are now explicitly named `service.ts` and `transport.ts`.
- `lib/server/http.ts` became `lib/server/responses.ts` to distinguish browser
  response handling from upstream transport.
- `app/lib/` helpers moved to `lib/client/api-error.ts` and `lib/shared/format.ts`.
- Shared test setup is now `test/fixtures.ts`; integration unit tests are named
  `drivehub-service.test.mts` and `drivehub-transport.test.mts`.

Earlier paths in this document describe historical stages. The current layout
and naming conventions are documented in README. Credential-file discovery
still uses the working directory (or the explicit environment override), not
the relocated configuration module's directory.

## Review findings closeout

- **Test typing:** removed the `.mts` exclusion. Typed configuration/service
  fixtures, request inputs, callbacks, deferred gates, captured HTTP messages,
  and error narrowing. Strict checks cover every unit test, Playwright spec,
  and synthetic preload. The Axios injection contract now accepts precisely
  the `request` method required by transport tests.
- **Frontend structure and lifecycle:** extracted `useSession`, `useBalances`,
  and `useTransactions` into `app/hooks/`. Dashboard presentation no longer
  owns HTTP orchestration. Expiration callbacks are stable. Balance requests
  are cancelled/versioned on replacement, unmount, and before awaiting logout.
- **Migration configuration:** `allowJs: false`; application and test code
  cannot silently enter the project as unchecked JS. The three plain-Node
  launcher scripts remain deliberate JavaScript exceptions, linted separately.
- **Regression coverage:** delayed balance responses cannot repopulate the UI
  after logout or overwrite a newly selected account category. Parent balance
  updates do not restart transaction fetching.

Current verification: strict type-check, lint, formatting, all **60 unit tests**,
production build, and **16 E2E tests** pass. The production dependency audit
reports zero vulnerabilities and `git diff --check` passes. A new Node 22.9
Docker build also passes strict type-check (including all test sources), lint,
all 60 unit tests, and production build. The earlier runtime smoke results above
belong to step 17; they are not substitutes for these new checks.
Remaining limitations: coverage and live DriveHub API verification have not been
performed. Node 22.9 clean install reports a transitive development-only ESLint
engine warning; no dependency compatibility upgrade is claimed here.
