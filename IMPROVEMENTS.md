# Production Improvements

## CURRENT STATUS

- Local hardening pass completed without an architecture rewrite, business-policy changes, deployment, or Git mutation.
- Server-side authentication, booking, payment, upload, contract, and staff protections are in place.
- Firestore rules and indexes were updated, but emulator behavior remains unverified because Java is unavailable.
- Production build, typecheck, active tests, and quiet lint pass locally.
- No OpenAI integration exists or was added.

## SECURITY IMPROVEMENTS

- Added Firebase ID-token verification and active-profile checks for privileged API requests in `lib/server-auth.ts` and `lib/firebase-admin.ts`.
- Restricted staff administration to administrators through `app/api/staff/route.ts`.
- Added authenticated, size-limited, folder-scoped Cloudinary upload/delete handling with MIME and signature validation.
- Restricted `app/api/contracts/route.ts` to staff with CMS permission; static contract previews remain intentionally public.
- Added ownership, role, permission, field, and default-deny rules in `firestore.rules`.
- Added server-authoritative booking creation in `app/api/bookings/route.ts` with catalog, pricing, capacity, date, availability, and atomic counter validation.
- Added server-authoritative payment submission in `app/api/payments/submit/route.ts` with ownership, status, amount, payment-type, and proof-folder validation.
- Moved booking/payment submission notifications to server-side writes.
- Removed direct client creation of legacy `officeRentals` records.
- Removed the obsolete shared `unreadCounts` client collection path; chat unread counts now use authenticated, client-scoped `chatMessages` queries.
- Scoped staff admin notifications by notification type so booking staff cannot read payment notifications and payment staff cannot read booking notifications.

## DEPENDENCY REVIEW

- Upgraded Next.js and `eslint-config-next` to `16.3.5`.
- Applied non-forced `npm audit fix` before this pass.
- Added `@firebase/rules-unit-testing@5.0.2` as a development dependency for emulator-ready rules tests.
- `npm audit` reports 9 moderate `uuid <11.1.1` findings.
- `exceljs@4.4.0` brings `uuid@8.3.2`; Firebase Admin's Google Cloud dependencies bring `uuid@9.0.1`.
- The suggested forced remediation installs `exceljs@3.4.0` and is not authorized.
- `npm outdated` reports many major-version updates; no broad upgrade was applied without compatibility review.

## LINT CLEANUP

- `npm run lint -- --quiet` passes with no errors.
- Full lint currently reports 151 warnings and 0 errors:
  - 71 `react-hooks/set-state-in-effect`
  - 34 `@next/next/no-img-element`
  - 33 `react-hooks/exhaustive-deps`
  - 6 `react/no-unescaped-entities`
  - 5 `react-hooks/purity`
  - 2 `react-hooks/preserve-manual-memoization`
- This pass fixed concrete callback-order, dependency, ref-state, and listener-lifecycle issues.
- `eslint.config.mjs` keeps legacy rules enabled as warnings; rules were not disabled to hide findings.

## TEST COVERAGE

- `npx vitest run`: 58 tests pass across the active unit-test files.
- Added `src/modules/shared/lib/__tests__/notification-access.test.ts` for staff notification scoping.
- Added emulator-ready `src/modules/shared/lib/__tests__/firestore.rules.test.ts` covering report access, permission-separated notifications, client ownership, and unread-counter denial.
- The rules suite skips when `FIRESTORE_EMULATOR_HOST` is not set, so the normal local suite remains runnable without Java.
- Server route unit tests and full emulator execution remain outstanding.

## FIRESTORE RULE REVIEW

- `reports` permission now grants read access to booking and payment records required by `app/(admin)/dashboard/reports/page.tsx`, without granting unrelated contract access.
- Admin notification reads and read-status updates are restricted to permission-relevant notification types.
- Client booking/payment/notification access remains ownership-scoped.
- Client booking updates remain limited to the approved request/status field set.
- `firestore.indexes.json` includes the notification type-filter index required by scoped staff queries.
- No rule deployment was performed.
- Emulator validation is blocked by missing Java and must be completed before deploying rules.

## PERFORMANCE

- Chat full-conversation listeners are lazy, bounded to 500 records, and now unload on chat-surface unmount or widget close.
- Chat unread queries are authenticated and bounded to 500 records.
- Booking provider data needs remain page-scoped; identity and permission changes clear cached datasets before new listeners load.
- Payment recovery results are ignored after provider teardown to prevent stale-account state updates.
- Residual performance risks remain in unbounded admin booking/payment queries, dashboard revenue aggregation, staff list loading, and repeated per-venue review fetches.
- No artificial caps were added to business-critical booking/payment datasets where truncation could hide records.

## REMAINING RISKS

- Firestore rules have not been behaviorally validated in the emulator.
- Legacy browser Firestore mutations remain in admin booking/payment workflows, receipt/payment-proof paths, reviews, and CMS/profile code; they require a separate migration review.
- The `uuid` audit findings require a compatible dependency upgrade or an explicit breaking-change decision.
- Full repository secret-history status is unknown; `.env.local` is ignored and values were not printed.
- The codebase retains duplicate/legacy chat and CMS implementations, including stale localStorage-oriented documentation in `CMS_ARCHITECTURE.md`.
- Existing lint warnings need incremental cleanup; the highest-value remaining groups are effect/state synchronization and hook dependencies.

## MANUAL ACTIONS REQUIRED

- Install Java and the Firebase CLI, start the Firestore emulator, set `FIRESTORE_EMULATOR_HOST`, and run `npx vitest run` to execute the rules suite.
- Review the 9 moderate `uuid` findings and the actual ExcelJS usage before considering any dependency change; do not use `npm audit fix --force` without approval.
- Review `.env.local` and all deployment/provider secret stores privately; rotate credentials if any value was ever exposed.
- Review and deploy `firestore.rules` and `firestore.indexes.json` only after emulator tests pass.
- Decide whether to migrate remaining browser admin mutations to server transactions.

## BUSINESS RULES REQUIRING CONFIRMATION

- No business rule changes were introduced in this pass. Existing one-month advance booking, capacity, availability, pricing, payment, cancellation, reservation, and Manila-time policies were preserved.
