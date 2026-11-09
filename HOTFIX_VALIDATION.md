# Final pre-deadline hotfix — 2026-11-09

## 1. Issues investigated

Balance-reminder action → lifecycle transaction → booking marker/email outbox → notification persistence → scoped realtime inbox → client rendering; active support-chat initialization, predefined-question cooldown, page/widget navigation; booking footers/tables; client transaction actions/history; payment-method views and unified financial reporting; deployed email-dispatch provenance/runtime readiness; office Name of Business terminology and compatibility.

## 2. Confirmed root causes

- **Reminder suppression:** `balanceReminderSent` was a permanent one-time gate. Repeated successful HTTP responses could have `changed: false`, which the provider/UI discarded while still showing a success toast.
- **Missing reminders:** the booking marker committed before a separate notification write. Notification errors were logged and swallowed, leaving a marker that permanently suppressed recovery. Email event IDs were also booking-wide rather than reminder-event-specific.
- **Inbox omissions:** missing-index recovery substituted an unordered first-100 query. Sorting that partial result locally cannot recover omitted recent records. This is source-confirmed; the deployed index state was not inspected.
- **Disappearing chat guidance:** the active implementation did not persist an automatic welcome message. Its predefined-question hook immediately recorded a display timestamp, then used that same timestamp to make `due` false and remove the displayed questions. A deferred scope reset could also invalidate an installed listener generation; clearing/reloading the same conversation did not necessarily restart it.
- **Cramped transactions:** fixed-width desktop tables allocated insufficient status/action space; the CSS badge was 8.5rem despite the documented 11rem convention. Unknown transaction methods could inherit a booking's selected preference.
- Several requested booking behaviors already existed: compact responsive action grids, separated client reference/event columns, newest-first admin ordering, original/current schedules, revision history, and canonical reporting. These were preserved rather than rewritten.
- **Email automation:** source inspection confirms deterministic outbox creation inside successful booking/payment transactions, scoped `after()` dispatch after commit, shared claim/lease/retry processing, and a guarded scheduled fallback. Production inspection remains read-only and cannot identify the active immutable build without authenticated deployment metadata/diagnostics: GitHub records a newer Production deployment of the pre-`after()` SHA, while both fetched immutable URLs returned Vercel authentication pages. No protected diagnostic call succeeded because no local `CRON_SECRET` was available; no worker invocation or email send was attempted. The source now exposes a protected `after-scoped-outbox-v1` marker and sanitized deployment SHA for owner verification after deployment, and route `maxDuration` is 60 seconds to cover bounded SMTP timeouts. This is a deployment/configuration/runtime readiness improvement, not proof of inbox delivery.
- **Office terminology:** office Final Details, client modification/details, and admin booking details now say **Business Information** / **Name of Business**, with the matching supporting description and placeholder. Persisted `companyName`, `eventName`, `natureOfBusiness`, terms, validation, server authorization, and event-booking labels remain compatible.

## 3. Changes implemented

### Reliability

- Reminder notification, booking/audit marker, optional durable request-key acknowledgment, and enabled email outbox job commit atomically. Every intentional event has its own notification/email identity.
- A conservative **24-hour per-booking cooldown** replaces permanent suppression. Same-key retries acknowledge their original event, including after the cooldown; suppressed keyed requests are also remembered. Concurrent different keys serialize through the booking transaction.
- Client requests coalesce repeated clicks and retain retry keys after lost/malformed responses. Both admin entry points disable the confirmation during saving and distinguish saved/suppressed/error feedback.
- Responses expose notification persistence, not an invented client-display or SMTP/inbox-delivery guarantee. Legacy sent markers without notification evidence remain explicitly unconfirmed.
- Ordered notifications retain their existing 100-record bound; index errors are visible/retryable, not silently replaced with a partial inbox. Cached reads do not establish completed synchronization.
- Chat clears/restarts history listeners with an explicit revision, resets account scope before listener setup, ignores cached-empty initialization, and correctly retains the client's conversation identity. Widget subscription acquisition/release follows actual visibility.
- A shared empty-conversation welcome is stable UI guidance, not a synthetic message or database write. Existing messages/automated answers are unchanged. Predefined questions remain visible for their current presentation when their own cooldown snapshot arrives; subsequent presentations still respect cooldown and dismissal.

### UI and ledger safety

- Existing admin action geometry/permissions/confirmations remain, with soft orange/rose/blue/emerald/amber tones and an accessible solid-orange onsite action. Completion eligibility is disclosed on demand.
- Client transactions retain horizontal scrolling, adequately sized status/action columns, 11rem badges, and 44px buttons without awkward desktop label wrapping.
- Payment Verification adds keyboard-accessible All Transactions / Bank Transfer / Pay at the Office tabs. Rows remain grouped by the same booking; method/status projections change visible transaction context, never the complete ledger or persisted statuses. The review modal opens the relevant method/transaction, with complete-ledger summaries and exact receipt matching intact.
- Unknown historical transaction methods remain in All; current booking preferences do not reclassify saved payments. Mixed bank/office collections stay attached to one booking/balance.
- Client submission history exposes each method, amount, timestamp, status, and complete receipt number. Existing e-receipts/proof/rejection history remain available.
- Booking tables retain readable widths and use canonical schedule normalization for AM/PM time ranges without changing availability, lifecycle, original schedules, or revision history.
- Reporting calculations were not changed. Added mixed-method reconciliation coverage for Total Booking Value, Received Payments, Verified Payments, Processed Refunds, Net Received Cash, and Outstanding Balance. No Gross Revenue / Net Revenue / Net Profit definition was introduced.

## 4. Files modified

### Application and feature code

```text
app/(admin)/dashboard/page.tsx
app/(admin)/dashboard/payments/page.tsx
app/api/auth/email-otp/route.ts
app/api/auth/register/otp/route.ts
app/api/bookings/cancellation/route.ts
app/api/bookings/lifecycle/route.ts
app/api/bookings/modification/route.ts
app/api/bookings/route.ts
app/globals.css
app/portal/bookings/page.tsx
app/api/internal/email-diagnostics/route.ts
app/api/internal/email-worker/route.ts
app/api/payments/onsite/route.ts
app/api/payments/review/route.ts
app/api/payments/submit/route.ts
lib/email-config.ts
app/portal/chat/page.tsx
app/portal/payments/page.tsx
src/modules/admin/components/booking-management-page.tsx
src/modules/admin/components/payment-review-modal.tsx
src/modules/client/contexts/booking-context.tsx
src/modules/shared/components/chat-widget.tsx
src/modules/shared/components/chat-welcome.tsx (new)
src/modules/shared/contexts/chat-context.tsx
src/modules/shared/contexts/notification-context.tsx
src/modules/shared/hooks/use-chat-suggestions.ts
src/modules/shared/lib/balance-reminder-client.ts (new)
src/modules/shared/lib/balance-reminders.ts (new)
```

### Tests and verification scripts

```text
src/modules/shared/lib/__tests__/availability-emulator.test.ts
src/modules/shared/lib/__tests__/balance-reminder-client.test.ts (new)
src/modules/shared/lib/__tests__/booking-payment-api.test.ts
src/modules/shared/lib/__tests__/email-config.test.ts
src/modules/shared/lib/__tests__/email-diagnostics-route.test.ts
src/modules/shared/lib/__tests__/firestore.rules.test.ts
src/modules/shared/lib/__tests__/report-calculations.test.ts
scripts/verify-admin-booking-actions.mjs
scripts/verify-booking-details.mjs
scripts/verify-booking-table.mjs
scripts/verify-dashboard-chat-notifications.mjs
scripts/verify-hotfix-reliability.mjs (new)
scripts/verify-payment-review.mjs
scripts/verify-safe-build.mjs (new)
scripts/verify-office-availability.mjs
scripts/verify-payment-submission.mjs
```

### Project references

`README.md`, `ARCHITECTURE.md`, `DESIGN_PALETTE.md`, `CMS_ARCHITECTURE.md`, `IMPROVEMENTS.md`, `PRELAUNCH_AUDIT.md`, `READ_LOADING_INVESTIGATION.md`, `docs/EMAIL_SETUP.md`, and this new `HOTFIX_VALIDATION.md`. Historical reports retain their original dates/findings, with labeled follow-up notes only.

### Final acceptance follow-up files

```text
firestore.indexes.json
src/modules/client/components/reserve-dialog.tsx
src/modules/shared/lib/__tests__/notification-access.test.ts
```

## 5. Validation results

| Check | Result |
| --- | --- |
| Full Vitest: `npx vitest run --maxWorkers=2` | **53 files passed, 1 skipped; 862 tests passed, 130 skipped, 0 failed (992 total).** Skips are conditional emulator tests, not counted as passes. |
| Disposable Firestore: rules + availability/reminder transaction suites, `--maxWorkers=1 --hookTimeout=60000` | **2 files / 141 tests passed; 0 failed, 0 skipped.** Includes the 130 conditional tests plus 11 repeated loopback-guard tests. New reminder concurrency, later events, read-state preservation, unchanged payment ledger, outbox atomicity, and browser retry/marker denial are covered. |
| `node scripts/verify-hotfix-reliability.mjs` | **24 checks passed**, no browser runtime errors; actual providers/hook with local service boundaries. |
| `npx vitest run` email dispatch/config/diagnostics subset | **4 files / 27 tests passed**, including scoped `after()` IDs, fallback/retry/claim races, duplicate prevention, historical exclusion, safe diagnostics, and transactional readiness reporting. |
| `node scripts/verify-admin-booking-actions.mjs` | **20 scenarios passed**, including saved/cooldown/error reminder feedback and double-click protection. |
| `node scripts/verify-office-availability.mjs` | **40 scenarios passed** at 1366/1280/390/320px, including Name of Business required-state validation, office submission persistence, Terms & Conditions, occupancy, full-term availability, and retry recovery. |
| `node scripts/verify-booking-details.mjs --no-screenshots` | **67 responsive scenarios passed**; screenshots deliberately skipped, geometry/keyboard/action assertions retained. |
| `node scripts/verify-booking-table.mjs` | **8 scenarios passed**: newest-first ordering, search/filter/status behavior, pagination, realtime insertion, and contained scrolling. |
| `node scripts/verify-payment-review.mjs --payments-only` | **108 assertions/scenarios passed**, including top-level method tabs, mixed-ledger receipts, historical aliases, preference changes, keyboard use, statuses/actions and money at seven widths. |
| `node scripts/verify-payment-submission.mjs` | **275 assertions/scenarios passed**, reference/proof/QR submission and responsive admin details. |
| `node --experimental-strip-types scripts/verify-payment-flow.mts` | **ALL CHECKS PASSED**; the harness does not emit an aggregate count. |
| `node scripts/verify-report-print.mjs` | **Passed** financial screen/Excel/print parity and responsive output; PDFs generated: **64,615 bytes with charts / 34,486 without charts**. |
| `node scripts/verify-payment-verification.mjs` | **Passed** actual provider/page tests for review success, post-commit refresh failure, lost/malformed responses, permission errors, duplicate clicks, exact selected IDs, matching client/admin receipts/totals, and the final account-scope recovery rerun. |
| `node scripts/verify-initialization.mjs` | **Passed** actual auth/booking provider initialization/retry/scope tests; fresh login performed exactly **1 server profile read**, including the final account-scope recovery rerun. |
| `node scripts/verify-dashboard-chat-notifications.mjs` | **19 scenarios passed**, including the post-fix 320px widget containment/44px touch-target check. |
| `npx tsc --noEmit` after build | **Passed** with no output. |
| `npm run lint` | **0 errors, 160 warnings** across 338 files; warnings are existing rule-level findings. |
| `node scripts/verify-safe-build.mjs --webpack` | **Passed** compilation, TypeScript, and **23/23** static pages with disposable identity, disabled email, and loopback emulators; never deploy this output. |
| Documentation / whitespace | **10 Markdown files checked, 0 missing targets**. Final `git diff --check`: passed. |

Browser sizes include **320, 375, 768, 1024, and 1440px**, plus 1280/1366px where the existing harness supports them. Reviewed saved desktop client-transaction, 320px admin-payment, and desktop/phone admin-footer screenshots. Fixtures use a local font fallback; application Inter/orange branding remains unchanged. Browser account cases are disposable identity/service fixtures, not live Firebase Auth accounts.

### Interim failures and corrections (not hidden)

- The first new reporting fixture used `amountPaid` instead of canonical incomplete-payment `amountReceived`; corrected the fixture, not the calculation contract.
- The first new real-Firestore reminder test assumed request ordering. Firestore may commit either caller first; it now identifies and replays the actual winning request key, retaining strict single-event assertions.
- Initial local browser harnesses encountered virtual-JSX parsing, missing CommonJS prebundling, cold 10-second navigation limits, and assertions between React/animation frames. Fixed only fixture setup/service boundaries and waiting for committed/settled UI. Size, alignment, workflow, keyboard, and money assertions were not weakened. Cold fixture navigation now has a separate 60-second deadline; UI action deadlines remain unchanged.
- An initial emulator setup exceeded its 10-second cold hook deadline. The final run uses one worker and a 60-second setup-hook limit; all 141 tests executed and passed.
- The first office browser run exceeded its 10-second cold Vite navigation deadline. Navigation alone now has a 60-second cold-start allowance; interaction assertions remain 10 seconds, and the rerun passed all 40 scenarios.
- The initial Turbopack attempt compiled successfully in 8.6 minutes but was stopped before its full build completed; it is **not** counted as a passing build. The complete isolated Webpack production build passed. A concurrent standalone typecheck collided with Next regenerating `.next/types`; no types/configuration were excluded, and the final check is serialized after building.

## 6. Remaining risks / limitations

- Browser workflows use actual components/providers with isolated service fixtures; they do not prove live Firebase Auth signup/relogin, deployed index readiness, production notification display, SMTP acceptance, or email inbox delivery. No live accounts or production records were created/modified.
- The welcome is deliberately empty-conversation guidance, not a newly persisted bot message. Existing persisted automated replies remain untouched. CMS-published suggestions remain authoritative for configured status groups; the existing built-in questions fill missing/empty groups, and clicking one still uses the authenticated idempotent answer route.
- Recent legacy sent markers may suppress another reminder until their 24-hour window ends even when old delivery is unconfirmed. Missing/invalid old timestamps cannot establish a cooldown. No legacy notification migration or replay was performed.
- Notifications remain bounded to the latest 100 records. Older persisted records are not deleted, but this task adds no inbox archive/pagination feature.
- The new reminder retry collection is protected by unchanged default-deny rules. The declared notification indexes now cover both the canonical ordered inbox and the scoped staff type-filter query; no Firebase index deployment was performed. Existing Firebase configuration, rules, payment authority, financial helpers, receipt identities, and production data are unchanged.
- Real-data financial reconciliation was not performed: no production ledger/refund records were accessed. Synthetic and emulator checks are explicitly distinguished from live accounting evidence.
- The active production alias still cannot be conclusively mapped to a commit from public metadata: GitHub shows Production deployment `a35c403` after the `56caf08` immediate-dispatch deployment, while both immutable URLs returned Vercel authentication pages. Protected diagnostics could not be read without an owner-supplied `CRON_SECRET`; transactional configuration, SMTP acceptance, job state, runtime timeout behavior, and inbox delivery therefore remain unverified in production. No worker endpoint was invoked and no production email was sent.

## 7. Production readiness assessment

Local validation is complete, but production readiness remains **owner-gated**. Before claiming automatic production email acceptance, an owner must confirm that the active alias reports `dispatch.implementation=after-scoped-outbox-v1`, `email.transactionalReady=true`, the intended Firebase project, and a current deployment commit; then perform an approved staging/controlled smoke test that distinguishes SMTP acceptance from inbox receipt. This batch does not authorize or perform a commit, push, deployment, Firebase-rules/index deployment, production-data operation, or actual production email. Existing dated audit findings/verdicts remain historical records, not superseded certifications.

## 8. Git working-tree status

The task started with a clean working tree. Changes are intentionally uncommitted; final status is **47 modified, 7 untracked (54 paths)**. No user changes were reverted or discarded. No commit, push, deployment, Firebase rules/index deployment, production-data operation, worker invocation, or production email was performed.

## 9. Follow-up after initial review — 2026-11-09

The original 54-path hotfix batch was committed and pushed after explicit owner approval as `74570c1` (`fix: complete release hotfix reliability`). A final acceptance follow-up then added the declared `notifications` composite index for the ordered staff type-filter query, replaced the last office validation message using `company / tenant` terminology with **Business Name**, and added a regression assertion for the index manifest. These follow-up edits remain local and uncommitted; no deployment or Firebase index operation was performed.

## 10. Final visual regression follow-up — 2026-11-09

The acceptance follow-up keeps the pre-existing local edits and adds the admin booking/payment table fit, count-aware Booking Details action grids, exact office Final Details copy, transaction-level method labels, and predefined-question fallback changes. Browser harnesses capture the six requested widths (320/375/768/1024/1280/1440) with table/action bounding-box checks and screenshots. Final local results:

| Check | Result |
| --- | --- |
| `node scripts/verify-booking-table.mjs` | **8 scenarios passed**; six requested widths, contained scrolling, table/action bounding boxes, and screenshots. |
| `node scripts/verify-payment-review.mjs` | **272 assertions/scenarios passed**; six requested widths plus 1366px, desktop fit/action bounding boxes, method tabs, receipts, and screenshots. |
| `node scripts/verify-booking-details.mjs` | **67 scenarios passed**; six requested widths plus 1366px, 1–5 action-grid geometry, document actions, keyboard order, and screenshots. |
| `node scripts/verify-admin-booking-actions.mjs` | **20 scenarios passed**; six requested widths plus 1366px, five-action thirds/halves geometry, permissions, reminders, modification, cancellation, and screenshots. |
| `node scripts/verify-hotfix-reliability.mjs` | **27 checks passed**; six requested widths, no welcome/message fabrication, built-in question fallback, answer selection, notification/chat retries, and screenshots. |
| `node scripts/verify-office-availability.mjs` | **40 scenarios passed** at 1366/1280/390/320px, including Name of Business copy/required-state validation and office workflows. |
| `node scripts/verify-payment-submission.mjs` | **275 assertions/scenarios passed**; payment submission, office details, receipt/proof, and responsive booking details. |
| `node scripts/verify-safe-build.mjs --webpack` | **Passed** compilation, TypeScript, and **23/23** static pages with disposable identity, disabled email, and loopback emulators. |

The full suite remains **53 files passed, 1 skipped; 862 tests passed, 130 skipped, 0 failed**, TypeScript passed, and lint reported **0 errors / 160 existing warnings**. All changes remain uncommitted and local; no production data, Firebase deployment, email dispatch, or live CMS publication was used.
