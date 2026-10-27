# Login, data-loading, and availability investigation

**2026-10-27 investigation snapshot.** Measurements below are observations from read-only service requests and controlled browser replays, not a production latency guarantee. No live booking/payment was replayed or mutated.

## Evidence and causes

| Finding | Evidence | Resolution |
| --- | --- | --- |
| Competing profile initialization | Browser replay of auth code at `3f319ed`: one sign-in issued two `users/{uid}` reads (login and auth observer). Each path could publish independently; failures were swallowed and late results were not identity-guarded. Releasing an old account's profile after the new one reproduces a wrong-current-profile overwrite. | One coalesced, server-confirmed profile initializer with identity/generation cancellation, explicit phases/errors, permission refresh and Retry. Next-router navigation keeps the initialized provider alive. |
| Empty UI could conceal a failed/unloaded query | Source and controlled failure replay: booking/payment read errors finished loading without a consumer-visible error. Cache-empty events could finish readiness; adding another dataset consumer could restart listeners. Payments also fetched the same ledger through both a subscription and a recovery query. | Server-confirmed initial readiness, stable subscription need keys, one unordered owner/permission-scoped listener per dataset, local sorting, bounded safe-read recovery, scoped state masking/cleanup, and actionable data errors. |
| Multi-tab persistence warning | Two-tab Chromium run with the actual Firebase browser SDK reproduced `failed-precondition`: “Failed to obtain exclusive access to the persistence layer … Falling back to memory cache.” Both public catalog reads succeeded. | Shared multi-tab persistence. The repeat two-tab run completed without that warning. This warning does **not** establish that the database was missing. |
| Availability fetched unrelated large payloads | Each complete booking scan transferred approximately **3,031,518 JSON bytes** for 35 documents, including inline proof/receipt snapshots; calculation was approximately 1 ms. | Project only complete scheduling/identity/lifecycle/hold fields for GET. Preserve full transaction reads and all legacy/all-date occupancy rules. Pipeline ledger checks with independent reads. |
| Unstable/expensive request inputs | Full bookings/receipts were serialized into refresh keys. Effects also depended on whole resource/catalog objects. | Compact scheduling keys, primitive request identity, UID/revision-scoped in-flight GET sharing, cancellation, stale-response guards and strict response validation. No completed/private availability cache. |

## Measured delays

Warm read-only Admin SDK requests against the configured database, two runs per case:

| Stage | Before | After |
| --- | --- | --- |
| Booking fields transferred for availability | 3,031,518 bytes / 35 docs | 26,875 bytes / 36 docs |
| Booking collection query | 1,613–1,816 ms | 495–524 ms |
| Venue database/hold path | 2,747–2,969 ms | 1,587–1,644 ms |
| Office database/hold path | 1,703–1,754 ms | 1,151–1,181 ms |
| Availability calculation | 0.9–1.3 ms | usually 0.7–1.9 ms; one 6.4 ms sample under concurrent browser verification |

The live collection grew during investigation; the optimization retains all rows and does not rely on the count staying fixed. Indexed owner-scoped booking/payment queries succeeded without missing-index errors. The observed owner booking read was about 2.5–2.6 seconds for 2.60 MB; its payment read was about 2.0–2.2 seconds for 5.88 MB. Eliminating the duplicate payment read removes an unnecessary second transfer of that ledger.

Actual browser SDK identity restoration in the signed-out two-tab probe took about **5–31 ms**; public catalog reads succeeded. Controlled authenticated browser traces separated token readiness, responses and React commits; calendar commits were **0–1 ms** in the lightweight fixture. Live password sign-in, signed-in token refresh, deployed end-to-end API/network latency, and production-device rendering were not benchmarked with a real user session.

## Relationship to payment verification

The prior payment failure was a **write exceeding Firestore's 1 MiB document limit**. Availability has a related **read-payload** cost because it downloaded those same proof/receipt-heavy booking documents. The auth initialization races and multi-tab ownership warning are separate defects; no evidence shows the payment write failure caused them.

## “Database hidden/missing” remains unidentified

The reporter supplied those descriptions but no exact message/screenshot. No corresponding hardcoded application message or missing database was found. Read-only queries and the real browser catalog probes succeeded. Suppressed read failures/empty states and the exact multi-tab warning above were independently reproduced, but neither is asserted to be the reporter's unidentified message.

## Verification and diagnostics

- `node scripts/verify-initialization.mjs`: real auth/booking providers, login dialog and protected layouts with service fixtures; fresh/returning sessions, logout/login as another user, obsolete profile/listener responses, direct routes, permission refresh, cached-empty events, bounded failure/retry, stable subscriptions and rapid room/month switching.
- Unit/API regressions cover token readiness/account changes, bounded read cancellation/retry, request coalescing/revision isolation, complete projected legacy blockers, unchanged transaction audit logs, event scheduling, office-exclusive occupancy, hold expiry, and payment flows.
- Verification run: **667 Vitest tests passed; 72 emulator-dependent tests skipped**, plus TypeScript and errors-only repository ESLint passed. The initialization browser harness and payment-verification regression passed. Office browser checks passed **40 scenarios**; maintenance passed **100 scenarios** across desktop/mobile widths. Existing React 18 shared-component ref warnings remain nonfatal in these fixture harnesses; no browser runtime errors were observed in the passing runs.
- Office/maintenance browser harnesses retain the actual form/provider/hook boundaries and responsive scheduling/error-recovery checks. Emulator suites require a disposable local emulator and skipped without it; no real emulator concurrency or rules validation is claimed for this run.
- `/api/availability` now supplies `X-Request-Id` and `Server-Timing`. Enable `?perf=1` or `NEXT_PUBLIC_PERF_TRACE` for stage traces; the environment flag also enables sanitized server timings/counts. Logs contain no ID tokens or full private documents.
