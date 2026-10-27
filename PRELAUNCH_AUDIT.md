# Pre-launch audit — One Estela Place

**Audit date:** 2026-10-21

**Scope:** current working tree, including the existing uncommitted payment-review/UI changes.

**Release verdict: NO-GO.** One critical authorization defect and multiple high-priority security, financial, and workflow defects remain open. A successful build/test run is not a launch-readiness certification.

This task audited and reproduced behavior; it did not apply application fixes, change financial policies, upgrade dependencies, deploy rules, or edit production data. Findings concern the checked-in/local implementation, not an inspection of deployed Firebase/Cloudinary settings.

## Evidence and severity

- **P0 / critical:** an authorization boundary permits privilege escalation. Fix before release.
- **P1 / high:** money, identity, record integrity, destructive operations, or a core workflow can behave incorrectly. Fix and regression-test before release.
- **P2 / medium:** confirmed validation, failure-state, presentation, or operational gaps requiring resolution and explicit release review.
- **Source-confirmed:** directly supported by the implementation. This does not mean a Firestore emulator or production exploit was executed.
- **Reproduced:** actual application components/route handlers ran against isolated service doubles, or the production build ran locally. The relevant boundary is specified below.

### Verification completed

| Check | Actual result / boundary |
| --- | --- |
| `npm run build` | Passed: compiled, type-checked, and generated all routes |
| `npx tsc --noEmit` | Passed independently after the build-generated declaration file was restored |
| `npx vitest run` | **152 passed; 8 skipped**. Skipped tests are the Firestore rules suite |
| Whole-repository ESLint API using the existing configuration | **0 errors, 148 warnings** |
| Canonical payment-flow harness | `node --experimental-strip-types scripts/verify-payment-flow.mts` passed; Node emitted its existing module-type warning |
| Payment-review browser harness | **65 checks passed**, using installed Chrome and local provider/service fixtures; existing shared-dialog ref warnings were observed |
| Additional isolated API/auth/business audit | **36 probes passed their current-behavior assertions**. Several deliberately assert the defects documented below; this is not a healthy-workflow pass |
| Production HTTP smoke | 15 page routes plus `robots.txt` and `sitemap.xml` returned 200; an unknown route returned 404 |
| Production unauthenticated API guards | All **18 tested method/path combinations** returned 401, including staff, upload, payment, and booking endpoints |
| Production anonymous browser guards | All **14 protected page routes** redirected to `/` |
| Production public-page responsive checks | Chrome at **320, 390, 768, 1440px**: no horizontal page overflow, missing local assets, or JavaScript runtime errors in those checks |
| Authenticated component/layout fixtures | **30 renders**: all 15 page surfaces at **390 and 1440px**, with appropriate client/admin identities and empty/default datasets. No horizontal page overflow or runtime exceptions in these render checks |
| Invalid input / service failures | Exercised malformed dates, capacity, amounts, unsupported profile fields, upload scope/size/signature validation, signup mismatch, unavailable availability/datasets, rejected profile reads, delayed login/profile reads, and failed maintenance writes |
| Concurrency | Local production HTTP smoke: **40 concurrent requests**, 20 public 200s and 20 unauthenticated 401s, about 72ms on this workstation. Isolated serialized-transaction model: one of 20 conflicting bookings succeeded; 20 repeated onsite requests produced 20 records/credits |
| Credential scan | 231 current text files and 628 reachable Git text blobs: no high-confidence matches for the scanned secret patterns. 48 built client JS/JSON bundles: no exact/escaped matches for configured `FIREBASE_ADMIN_PRIVATE_KEY` or `CLOUDINARY_API_SECRET` values |
| Literal internal references | All scanned literal internal page/file references resolved; placeholder footer links are separately reported below |
| Dependency audit | `npm audit --omit=dev --json`: **18 vulnerable package entries — 1 critical, 8 high, 9 moderate** |
| Documentation/working-tree check | `git diff --check` passed; the pre-existing application changes were preserved |

The browser fixtures executed the real pages, layouts, auth/booking/chat/CMS providers, and relevant UI handlers. Firebase SDK/service boundaries, network responses, and Next navigation/image adapters were substituted as needed. The production-browser smoke used the real built Next application anonymously, with external services blocked. Fixture rendering used a local sans-serif font fallback.

## Launch blockers

### P0-01 — Staff with Users permission can promote their own account to admin

**Evidence:** `firestore.rules:243-271`, especially the unrestricted staff update branch at **257-258**; `lib/server-auth.ts:90-141`.

`users` permission permits updating any user document without a field allowlist, target restriction, or protected-role check. A staff account with `permissions.users === true` can change its own `role` to `admin`, or change another account's role/permissions. The API then trusts that updated profile on the next request; Firebase token replacement is unnecessary.

**Reproduction:** in an emulator, authenticate such a staff account and update its own user document's role. An isolated real-auth-helper/API probe confirmed that the same UID goes from 403 to 200 on the admin-only staff endpoint after the profile mutation. The write-permission portion is source-confirmed, **not emulator-executed**.

**Required fix:** make role, permissions, UID, and account-status mutations admin/server-only. Restrict staff Users access to its intended client-profile fields and targets. Add emulator tests for self-promotion, editing admins/other staff, and permission changes.

### P1-01 — A client-editable avatar URL can authorize deletion of unrelated Cloudinary images

**Evidence:** `app/api/cloudinary/delete/route.ts:65-81`; user-writable `profilePicture` in `firestore.rules:251-270`.

The deletion endpoint first checks UID-scoped folders, then trusts the public ID extracted from the caller's stored avatar URL. That avatar field is client-controlled. Setting it to a public CMS image URL makes deletion of that CMS public ID pass authorization.

**Reproduced:** an ordinary client was denied deletion of `cms/public-photo`; after its profile URL was set to the corresponding synthetic Cloudinary URL, the real route returned 200 and invoked the mocked destroy operation with that unrelated public ID. No real asset was deleted.

**Required fix:** authorize from immutable/server-owned asset ownership metadata or the UID-scoped public-ID namespace. Do not treat a client-supplied URL as proof of ownership; handle legacy assets through an explicitly trusted association.

### P1-02 — Change Password reports success without changing the password

**Evidence:** `app/portal/profile/page.tsx:103-127`.

The handler only checks nonempty fields/password equality, displays a success toast, and clears the inputs. It does not reauthenticate or call Firebase password update.

**Browser reproduction:** enter an incorrect current password and matching one-character new passwords. The actual profile component reports **Password Changed**, with zero password-update calls, zero reauthentication calls, and zero API requests.

**Required fix:** implement Firebase reauthentication and password update, enforce the configured password policy, and report success only after persistence succeeds. Test wrong current password, weak new password, expired session, and offline failure.

### P1-03 — A positive sub-cent amount becomes zero, then verification can credit the whole booking

**Evidence:** `app/api/payments/submit/route.ts:39-45`; `app/api/payments/review/route.ts:276-285`.

Submission validates positivity **before** currency rounding. `0.001` becomes `0` but still creates a pending payment. Review of that zero-amount record can fall back to the booking total, because the submitted-amount ceiling applies only when the submitted amount is positive.

**Reproduced:** a synthetic ₱10,000 booking accepted a `0.001` down-payment request and persisted amount 0. Verifying the returned payment ID without an explicit received amount then credited ₱10,000.

**Required fix:** validate the normalized currency amount, reject sub-cent/zero results, and require a valid transaction-specific confirmed amount. Never infer an individual received payment from the booking total. Test both submission and review paths, including onsite rounding.

### P1-04 — A partially paid booking can receive a refund larger than money received

**Evidence:** `src/modules/shared/lib/cancellation.ts:236-280`, particularly `refundAmount: eligible ? totalPrice : 0`.

Refund eligibility checks payment activity, but the amount uses the whole booking price. The refund-completion endpoint subsequently records completion without reconciling that amount with the canonical payment ledger.

**Reproduced:** total price ₱10,000, amount received ₱5,000, sufficiently early cancellation → eligible refund amount **₱10,000**.

**Required fix:** calculate refunds from actual eligible received funds under an explicitly approved refund policy. Do not silently choose a new percentage or exceed received money. Reconcile completed refunds with financial reporting and test partial/incomplete payments and existing refunds.

### P1-05 — Payment review and lifecycle transitions can resurrect cancelled bookings

**Evidence:** `app/api/payments/review/route.ts:259-325`; `src/modules/shared/lib/payment-verification.ts` booking-status writes; `app/api/bookings/lifecycle/route.ts:347-388`.

Payment review checks the individual payment's resolution, but does not reject a cancelled/approved-cancellation booking. Lifecycle actions also lack consistent terminal-state/stage guards.

**Reproduced:** verification of a pending balance on a cancelled booking returned 200, changed the booking to `confirmed`, and retained `cancellationStatus: Approved`. Separately, `contract_signed` changed a cancelled, unpaid office booking into `active_rental`.

**Impact:** contradictory records, invalid reactivation, and possible conflicts with a replacement reservation after a cancellation released the slot.

**Required fix:** enforce terminal/stage transitions inside the transaction. Replays must preserve cancellation/completion and must not bypass availability or office-payment prerequisites. Add cancellation-versus-review and delayed/retried-action tests.

### P1-06 — CMS saves can roll back the server booking counter and overwrite concurrent changes

**Evidence:** `src/modules/admin/contexts/cms-context.tsx:576-619`; `app/api/bookings/route.ts:338-425`.

CMS saves replace the complete `cms/data` document from the editor's local snapshot. Booking creation updates `bookingCounter` on that same document. A stale CMS save can overwrite a newer counter, or remove it when saving defaults before a current snapshot arrives. Other editors' sections can also be lost.

**Reproduced:** the actual CMS provider's stale/default save removed a counter introduced by a simulated server update. A separate real booking-route probe, with an already-used booking ID and a rolled-back counter, failed with 500 on `transaction.create`.

**Required fix:** separate server-owned counters from public content or protect them through field-level/transactional persistence. CMS writes must preserve server metadata and concurrent section updates. Test two editors and simultaneous bookings against the emulator/staging database.

### P1-07 — Delayed/failed profile reads can leave the wrong UI identity active

**Evidence:** `src/modules/shared/auth/auth-context.tsx:127-204`; booking/chat datasets depend on that context identity for clearing and subscription changes.

Auth-state callbacks await profile reads without invalidating older callbacks or clearing the previous user immediately. Errors log to the console without clearing that previous user.

**Browser reproduced using the real AuthProvider:** Firebase UID B with a rejected profile lookup left app user A active. A held profile read for A, completed after a sign-out event, restored app user A while Firebase `currentUser` was null.

**Impact:** stale-account UI and potentially previously loaded account data can remain visible on shared/session-changing clients. This is not a demonstrated bypass of server-side booking ownership checks; those guards remained effective in the isolated API tests.

**Required fix:** clear identity/data immediately on Firebase identity changes, track an auth generation/request token, ignore stale completions, and fail closed with a visible profile-load error. Test sign-out, cross-tab/session changes, delayed reads, denied reads, and inactive accounts.

### P1-08 — Expired unpaid bookings can block availability indefinitely

**Evidence:** `src/modules/shared/lib/booking-helpers.ts:308-325`; `app/api/bookings/lifecycle/route.ts:278-323`; the expiry trigger in the client payments page.

Pending bookings always block availability, independent of payment-window age. Repository-side expiry is initiated by the owning client's page; no repository-side scheduled cleanup was found. Closing the browser prevents that trigger.

**Reproduced:** a 48-hour-old unpaid booking is both payment-window-expired and availability-blocking. Another client received 409 for its slot in the isolated booking-route test.

**Required fix:** enforce unpaid expiry server-side or through a scheduled authoritative job. Preserve bookings with received money/pending payment review. Verify deployment-side scheduling separately; external infrastructure was not available to this audit.

### P1-09 — Retrying an onsite payment can create duplicate monetary credits

**Evidence:** `app/api/payments/onsite/route.ts:121-289`, including a fresh payment UUID on every accepted request at 188-189.

The endpoint has no operation/idempotency key. If a response is lost after commit, replaying the same cash-recording operation creates another payment while a balance remains. UI submission guards cannot resolve an ambiguous committed response or duplicate submissions from different admins.

**Reproduced:** two identical ₱1,000 requests created distinct payment IDs and ₱2,000 credit. In a serialized 20-request model, 20 identical ₱100 requests created ₱2,000 credit.

**Required fix:** use a stable operation key and atomically return the existing result on retries. Test response loss, refresh/retry, two admins, and concurrent duplicate requests. The model validates handler behavior, **not real Firestore contention or throughput**.

### P1-10 — Clients can forge receipt and audit metadata for their own bookings

**Evidence:** `firestore.rules:151-181,310-327`; legacy receipt presentation in `src/modules/shared/lib/payment-calculations.ts`.

Owners can directly create/update their booking's receipts without validating amount, status, reviewer, or payment relationship. Client booking updates also allow replacing `receipt`, `paymentReceipts`, receipt-issued metadata, and `adminLogs`.

**Reproduction:** the rules admit a client-owned receipt claiming `Verified` and a fabricated amount. A receipt-presentation probe confirmed that such a legacy projection renders a verified transaction even with zero credited booking payments. The write admission is **source-confirmed, not emulator-tested**.

**Important distinction:** clients were not able to verify actual `payments` records through the tested API, and receipt data did not increase the canonical ledger in this probe. The defect is forged receipt/audit integrity, not a proven client payment-document write.

**Required fix:** make authoritative receipt and admin-audit writes server-only. Keep client reads ownership-scoped; issue receipts through the authorized API using payment IDs. Add rules tests for forged receipt statuses, amounts, links, and log replacement.

### P1-11 — Chat stops showing new messages after the oldest 500 records

**Evidence:** `src/modules/shared/contexts/chat-context.tsx:167-204`.

Conversation listeners order ascending and apply `limit(500)` without pagination. They retain the oldest records. The admin listener's limit is global across clients, so one or several histories can exclude newer conversations altogether.

**Browser reproduced with the real ChatProvider:** 501 chronological messages existed; the provider loaded the first 500 and omitted the newest message.

**Required fix:** load the latest bounded page and support older-history pagination, with per-conversation admin queries where appropriate. Verify new-message visibility, unread counts, and more than 500 messages across multiple clients.

### P1-12 — Installed production dependencies require a current security review/patch pass

**Evidence:** `package.json`, `package-lock.json`, and the live `npm audit --omit=dev --json` result on the audit date.

There are **18 vulnerable package entries: 1 critical, 8 high, 9 moderate**, including Next.js 16.3.5, Firebase/gRPC dependencies, multipart parsing, Sharp, and UUID-related chains. These counts include transitive affected packages; they are not 18 independent demonstrated application exploits.

The critical Next advisory is [GHSA-vcvr-r3jv-pc5j](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j), concerning `next/og` ImageResponse. No `ImageResponse`/`next/og` use was found in the audited app routes. **Reachable application RCE was not reproduced.** Other Next advisories concern caching, development endpoints, metadata routes, and image optimization; applicability depends on the deployed features/configuration.

**Required fix:** review reachability and select compatible patched versions, then rerun build, flows, and audit. This audit did not upgrade packages or execute third-party exploit payloads. The historical dependency count in `IMPROVEMENTS.md` is not the current result.

## Additional confirmed issues

| ID | Issue and evidence | Reproduction / required action |
| --- | --- | --- |
| P2-01 | Modification validation is weaker than booking creation. `app/api/bookings/modification/route.ts:102-129,132-256` | Real route probes accepted `2099-02-31`, guest count 1,000 for a 50-capacity venue, and an object-valued event name. Enforce real calendar dates, field types/lengths, immutable booking category, and catalog capacity on request and approval |
| P2-02 | Office-flow rules/presentation disagree. `app/api/bookings/route.ts:210-215`; `reserve-dialog.tsx:777-785`; `payment-calculations.ts` receipt DP adapter | An unrelated active venue booking caused the office API to return “active office rental” despite the UI checking only active offices. The actual server office shape (`slot_reservation`, configured selected amount equal to price) also produced a DP requirement in receipt presentation, while the canonical office ledger required no DP. Align both flows with the approved office requirements |
| P2-03 | Service failures appear as loading, empty data, or successful writes. `reserve-dialog.tsx:494-526,1225-1228`; `booking-context.tsx:1114-1143,1366-1388,2455-2468`; admin bookings maintenance save handler | Browser probes: failed availability requests left disabled “Loading availability” dates without showing the error; failed payment/booking reads showed “No active transaction”; a failed maintenance commit saved nothing but displayed “Maintenance Added.” Await writes, roll back failed optimistic changes, and expose explicit retryable error states distinct from empty datasets |
| P2-04 | Login has no per-request submitting state. `src/modules/shared/auth/login-dialog.tsx:33,58-99,143-144` | Holding the sign-in operation allowed two clicks to start two requests; the button's disabled/loading state uses initial auth-provider loading instead. Add a pending guard, visible progress, and failure recovery |
| P2-05 | Refund-request notifications are excluded from staff notification permissions/types. `app/api/bookings/refund/route.ts:149-161`; `notification-access.ts:4-28`; `firestore.rules:126-148` | The server writes `refund_requested`, but booking/payment staff allowlists omit it and the shared notification type union omits it. An admin can see all admin notifications; relevant staff cannot receive this notification through their scoped queries. Define and test the intended refund audience |
| P2-06 | Privacy Policy and Terms of Service links are placeholders. `src/modules/client/components/public-layout.tsx:327-332` | Both actual production-build links resolve to `#`; they do not open policy content. Supply functioning destinations/content and check keyboard/mobile access |
| P2-07 | Local production responses lack explicit security headers. `next.config.mjs`; measured response headers | No CSP/frame restriction, Referrer-Policy, Permissions-Policy, or X-Content-Type-Options was returned locally; X-Powered-By exposed Next.js. Inspect hosting/proxy headers before deployment and implement a compatible policy where absent. This was not a demonstrated exploit or a measurement of the production host |
| P2-08 | Fallback policy text conflicts with enforced rules. `src/modules/shared/lib/policies.ts`; booking/payment/cancellation helpers | Fallback copy includes 30%/48-hour initial payment and differing cancellation/refund thresholds; active code uses the configured DP (50% default), a 24-hour window, and 7/14-day cancellation thresholds. Published live CMS policy content was not fetched. Reconcile the actual published text, fallback text, and approved server policy |

## Coverage by user flow

| Area | Checked | Still required |
| --- | --- | --- |
| Public site / navigation | Production route/assets/link smoke, real public responsive screenshots, fixture rendering | Live CMS publication, real social destinations and external tour/CDN behavior |
| Login / signup / profile | Real UI components with delayed/offline SDK doubles; mismatch validation; stale-auth reproductions; fake password change; API role/inactive/field guards | Successful real signup/login, actual password reset delivery, real password/email changes, provider password/email-verification policy, deployed auth-domain settings |
| Booking / availability | Actual handler validation and ownership; privacy-minimized availability output; conflict/expiry probes; reservation UI failure state | Full successful browser-to-staging-database booking, real multi-user transaction contention, maintenance-versus-booking races, real index deployment |
| Payments / receipts | Existing ledger tests/harness; proof/note modal checks; real handlers with isolated submissions/review/onsite operations; rounding/retry/terminal-state probes | Real provider credentials/upload delivery and successful staff/client staging flow; receipt/rules integrity tests; response-loss retries against real persistence |
| Cancellation / modification / refund / office | Helper tests and actual handler probes, refund overpayment, invalid modification and office inconsistencies | Complete approved/declined/refunded staging journeys, contract-signing prerequisites, approved business-policy reconciliation |
| Staff / permissions / database rules | All unauthenticated endpoint guards, real server role checks against profile doubles, source-level collection ownership/permission review | Firestore emulator execution, deployed-rules comparison, restricted staff identities attempting every privileged collection mutation |
| CMS / uploads | Real provider save collision simulation; upload folder/MIME/signature/size probes; asset-delete authorization reproduction | Two-editor real persistence test, server counter preservation, real asset access/lifecycle and credential restrictions |
| Chat / notifications / reports | All page/layout fixture renders, actual ChatProvider 501-message reproduction, notification allowlist review, existing report calculation tests | Paginated cross-client chat, real notification delivery, populated multi-page report export/print and large-ledger performance |
| Slow network / offline / load | Held/rejected auth reads, held sign-in, failed availability/datasets/writes, local 40-request HTTP smoke, 20-request isolated transaction models | Authenticated production-like load, Firestore contention/ABORTED behavior and throughput, load with provider quotas, server memory/body-limit tests, browser reconnect/offline-queue integration |

## Important limits and retained evidence

- **Firestore rules were not behaviorally tested.** Java and the Firebase CLI were unavailable. The eight existing rules tests skipped. The two rules integrity findings above remain launch blockers based on explicit allow branches; run emulator reproductions after fixing them.
- No authenticated requests or mutations were sent to live Firebase or Cloudinary. No real users, passwords, receipts, reservations, or assets were changed. Public/provider traffic was blocked in the production browser smoke.
- Real deployed secrets, API-key restrictions, live database/index rules, provider quotas, storage/media-access settings, HTTPS/proxy headers, backups, monitoring, and scheduled expiry infrastructure were not inspected.
- The secret scan is a bounded pattern/history scan plus exact/escaped bundle comparison, not proof that every possible encoded credential or external secret store is safe. Firebase browser `NEXT_PUBLIC_FIREBASE_*` configuration is intentionally public and was not falsely classified as an Admin/Cloudinary secret.
- “No runtime errors” applies only to the exercised scenarios. Authenticated fixture render screenshots primarily used empty/default datasets. Business probes cover selected adversarial cases, not every possible state transition.
- The concurrency model serializes transactions and cannot reproduce Firestore locking, phantom-query behavior, retries, or distributed latency. The fast local anonymous HTTP smoke is not a production capacity result.
- Existing shared-dialog React ref warnings, 148 lint warnings, and the payment harness's Node module-type warning remain. They did not fail the checks above and do not cancel out the functional/security findings.

Temporary reproducer files on this workstation are under `C:\Users\Jek\AppData\Local\Temp\opencode\`:

- `prelaunch-api.audit.test.ts`, `prelaunch-audit.config.mjs`, `audit-server-only.mjs` — isolated route/auth/business probes. Run with `npx vitest run --config "C:\Users\Jek\AppData\Local\Temp\opencode\prelaunch-audit.config.mjs"`.
- `prelaunch-inventory.mjs` — redacted source/history/bundle and literal-route inventory.
- `prelaunch-browser-audit.mjs` — actual components/providers with isolated SDK boundaries; latest screenshots under `prelaunch-browser-YMqdgu\one-estela-payment-review-VQULe1\`.
- `prelaunch-production-smoke.mjs` — fresh local production server, anonymous routes/APIs, responsive and concurrent HTTP checks; screenshots/result JSON under `prelaunch-production-uz9hHd\`.
- Payment-review regression screenshots: `one-estela-payment-review-wfhVZE\`.

These temporary files contain synthetic fixture data and do not configure or replace the application services. Paths and audit counts are a dated record, not a standing claim about future source revisions.

## Release decision

**Do not launch this working tree yet.** Resolve P0-01 and the P1 findings, add regression coverage for the reproduced failures, and review the P2 items. Then execute the missing Firestore-emulator and authenticated staging/provider journeys. Reassess readiness from those results; do not infer it from a green build or the existing 152 unit tests alone.
