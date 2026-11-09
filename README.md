# One Estela Place

**Pre-deadline hotfix (2026-11-09):** Balance reminders now atomically persist the client notification, booking audit, retry record, and (when enabled) email job. New reminders are limited to once per booking per 24 hours; retries acknowledge the original event, and UI feedback distinguishes saved, suppressed, and failed requests without claiming client display or email delivery. Chat initializes listeners before accepting empty history, keeps currently displayed predefined questions through their own cooldown synchronization, falls back to the existing built-in question set when CMS publication is absent for a status group, and shows a stable empty-conversation welcome without inserting synthetic messages. Payment Verification adds transaction-method tabs while preserving the complete booking ledger; historical unknown methods remain unclassified rather than inheriting the booking preference. Admin booking/payment tables fit the available wide-desktop content area while retaining contained scrolling below it, readable statuses, and 44px actions; booking footers use count-aware equal-width grids and soft semantic colors. See [HOTFIX_VALIDATION.md](HOTFIX_VALIDATION.md) for validation evidence and limitations.

**Immediate email dispatch follow-up (2026-11-09):** Successful booking/payment route transactions now schedule only their newly-created deterministic outbox job IDs through Next.js 16 `after()` for best-effort post-response processing. Transactional and fallback worker routes declare a 60-second platform budget to cover bounded SMTP verification/send timeouts; the same claim/lease/retry worker is reused, and failures do not change the committed business response. Jobs remain available to the approximately five-minute GitHub Actions fallback. No inbox receipt timing is guaranteed or claimed without an owner-authorized production test. The protected diagnostics response includes an implementation marker and sanitized deployment commit when the platform provides one.

**Email/verification follow-up (2026-11-09):** New email/password Clients use an OTP-first signup flow at `/verify-email`: a server-only pending registration stores profile fields and an HMAC-bound code, but creates no Firebase Auth identity or Client profile before successful OTP verification. The original signup password is held only in the globally mounted `AuthProvider` ref during the active client-side route transition; after OTP success the browser automatically creates Firebase Auth and a protected server finalizer creates the Client profile with the immutable `emailVerificationRequired` marker. Refreshing or interrupting the flow safely requires signup restart because the password is not persisted. Challenges have expiry, cooldown/rate limits, attempt limits, single-use authorization, replay protection, and safe delivery-failure handling. Existing authenticated Clients retain the server OTP path, and the older Firebase link remains an explicit compatibility fallback behind `NEXT_PUBLIC_EMAIL_VERIFICATION_LINK_FALLBACK_ENABLED`. An optional rollout boundary covers unmarked legacy password accounts without unexpectedly locking legacy or federated accounts. Gmail SMTP notifications use a server-only, disabled-by-default Firestore `emailOutbox`; deterministic jobs are created inside committed booking/payment/lifecycle transactions, and the protected worker uses Auth UID recipient resolution, explicit production allowlist mode, leases, bounded retries, and terminal states. A guarded Admin/staff rejection action covers only unsecured pending bookings with no payment activity. A five-minute GitHub Actions worker workflow is checked in with a separate false-by-default activation gate, but no scheduler activation, credentials, production records, sends, or deployments are performed by the repository. See [docs/EMAIL_SETUP.md](docs/EMAIL_SETUP.md).

Booking and rental management system for **One Estela Place**: event venue reservations, office room rentals, payment verification, customer support, and website content management.

Source reviewed: **2026-10-19** baseline; resource identity, scheduling, maintenance, and CMS persistence rechecked **2026-10-25**; exclusive office occupancy and customer/admin Booking Details rechecked **2026-10-26**; session initialization, read recovery, and availability performance rechecked **2026-10-27**; compact booking/payment tables rechecked **2026-11-03**; protected portal/admin shell scrolling rechecked **2026-11-04**; CMS responsive/accessibility surfaces, Phase 2.1 table scrolling/admin booking ordering, and lifecycle/payment presentation rechecked **2026-11-05**; Phase 5 release-readiness validation, REF-01 refund authorization, CHAT-01 cursor pagination, baseline response hardening, client loading/New Booking recovery, and Defense Polish 2.2 accessibility/chat-read resilience rechecked **2026-11-06**; Admin Dashboard Payment Position removal, natural content-flow cleanup, Client Chat Firestore index hotfix, and Defense Polish 2.5 booking schedule controls/history rechecked **2026-11-07**. This documentation describes the checked-in implementation; live catalog values and provider configuration come from the connected services.

Defense Polish 2 direct administrative booking modification/cancellation workflows and their local browser/API regressions were rechecked **2026-11-06**. Direct cancellation remains Admin-only, uses the existing cancellation/refund eligibility policy without processing refunds, and records an actor/reason audit trail; staff with `bookings` permission retain direct modification access.

Defense Polish 2.1 presentation refinements (**2026-11-06**) keep those workflows unchanged: compact Admin Booking Details actions, padded/scrollable Modify Booking forms, one primary admin booking-table badge, aligned payment statuses/actions, title-only headers on the six main dashboard/booking/payment pages, and no Client Dashboard Payment Overview. Recent Payments and My Transactions remain available.

Defense Polish 2.2 (**2026-11-06**) adds named semantic toolbars with visually hidden page headings, accessible loading/error announcements, responsive semantic Staff Management and Users Information tables, and labeled/focus-visible 360° tour controls. Chat reads and read-state recovery remain bounded and authorization-scoped: canonical ordered/index queries preserve their required composite-index errors until deployment, while the separate equality-only lane is limited to timestamp-less legacy-record discovery and is not treated as complete canonical history.

Defense Polish 2.2.2 (**2026-11-07**) preserves the dark Take a Tour surface while correcting venue/office card foreground contrast, including capacity text, icons, descriptions, tab states, and focused/expanded controls. The focused `verify-tour-contrast.mjs` browser regression checks computed contrast at 320/375/768/1024/1440px without changing catalog values, booking calculations, or tour behavior.

The Admin Dashboard keeps Recent Bookings, Needs Attention, and Total Records while omitting the presentation-only Payment Position cards and helper note. Its page content now flows directly from the stat cards into the dashboard columns; shared admin-shell sizing, metrics, provider reads, navigation, and Firestore behavior are unchanged.

The Client Chat Firestore index hotfix adds the required `chatMessages` collection index for `clientId ASCENDING`, `timestamp DESCENDING`, and `__name__ DESCENDING`. It is declared locally in `firestore.indexes.json` for project `oneestela-ae9b5`; no index or rules deployment was performed.

**Follow-up (2026-11-07):** Notification presentation now normalizes supported timestamp shapes, sorts undated records last, shows `Date not recorded` when no timestamp is recoverable, and discloses long messages without changing notification routing or read behavior. Client booking search/actions, compact client/admin payment records below `xl`, shared admin booking status presentation (including `Rejected` filtering), active-only sort indicators, and separated Reports controls/summary sections were rechecked without changing workflows or financial calculations.

**Defense Polish 2.4 follow-up (2026-11-07):** Admin Reports uses a compact nine-column summary table at wide desktop widths, expandable complete booking/financial details, and labeled compact records below `xl`. Excel and print/PDF outputs continue to use the complete filtered fourteen-field report projection. The Admin Payment Verification modal filters visible history by `All Payments`, `Bank Transfer`, or `Pay at the Office`; its booking-level summary and exact payment-to-receipt matching always use the complete ledger.

**Defense Polish 2.5 (2026-11-07):** Direct `admin_update` booking writes accept only `eventName`, `date`, `startTime`, and `endTime` from Admin callers; the server rejects venue/resource, guest, tenant, rental-term, notes, lifecycle, payment, and unknown fields. Availability, resource identity, capacity, authorization, audit, notification, and transaction-lock behavior remain server-authoritative. A successful schedule change preserves the first trusted `originalSchedule` and appends every successful transition to `scheduleHistory`; no-op, rejected, and failed transactions append nothing. Temporary `originalBookingSnapshot` data remains separate for the client request/review workflow. Admin and Client Booking Details display Manila-readable Original Schedule and Current Schedule values, while Admin can inspect the complete revision list. Admin Modify Booking is one unified screen with read-only booking context, editable event name, a client-style availability calendar with available/partial/full/maintenance states, conflict-aware time slots, current/proposed schedule comparison, and no resource, guest, tenant, rental-term, or notes controls. The Admin contract-signing action spans the full action grid without changing its existing lifecycle behavior.

## Start here for future prompts

Read these project references first, then open the source files relevant to the requested change:

| Document | Purpose |
| --- | --- |
| [README.md](README.md) | Project context, setup, routes, and development commands |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Module map, providers, APIs, data ownership, and business invariants |
| [DESIGN_PALETTE.md](DESIGN_PALETTE.md) | Colors, typography, layout, and reusable UI styling |
| [AGENTS.md](AGENTS.md) | Reading order and working instructions for coding assistants |

[CMS_ARCHITECTURE.md](CMS_ARCHITECTURE.md) adds CMS-specific detail. [IMPROVEMENTS.md](IMPROVEMENTS.md) is a historical engineering report, not a current test result or complete description of today's implementation.

[PRELAUNCH_AUDIT.md](PRELAUNCH_AUDIT.md) records the **2026-10-21** pre-launch audit, reproduced blockers, verification coverage, and remaining limitations. Its verdict is **NO-GO** for that audited working tree; it is a dated finding report, not a readiness certification for later revisions.

[READ_LOADING_INVESTIGATION.md](READ_LOADING_INVESTIGATION.md) records the **2026-10-27** read-only measurements, reproduced login/cache failures, fixes, and limitations for login/data loading and booking availability.

## Product overview

- **Public website:** CMS-driven landing page, past-client gallery, FAQs, login/signup dialogs, and a 360-degree tour.
- **Client portal:** create venue/office reservations, track bookings, submit bank-transfer proof or select onsite payment, view transactions/receipts/contracts, request changes or cancellation, and chat with support.
- **Admin dashboard:** booking management, authorized direct booking modification and Admin-only eligible cancellation, payment review, onsite payment recording, reports and Excel export, staff administration, CMS, and user information.
- **Staff access:** dashboard features are controlled by per-module permissions.
- **Responsive records:** booking/payment lists plus Staff Management and Users Information use compact semantic tables where space permits and labeled condensed rows at narrower widths; Client My Transactions and Admin Payment Verification switch to compact records below `xl`, while Reports uses expandable details below and within its compact summary presentation. Existing filters, pagination, grouping, ownership checks, calculations, permissions, and actions remain unchanged.
- **Protected workspace scrolling:** the client and admin shells are viewport-bounded flex layouts whose content panes own vertical scrolling; side navigation scrolls independently and record tables keep horizontal scrolling contained to their table region without blocking vertical scroll chaining. Booking Details and Admin Modify Booking keep their schedule/history cards inside the existing bounded scroll surfaces.

The application roles are `admin`, `staff`, and `client`. An owner uses the admin role; `owner` is not a separate supported account role in the auth model.

Reservations use persisted CMS resource IDs and parent-office/room pairs, not display names or customer event types. Each office room permits only **one ongoing reservation/lease across all dates and customers**, checking both `bookings` and `officeRentals`; planned lease end dates do not release occupancy. Scheduling writers share resource locks and reject conflicts; abandoned unpaid 24-hour holds are checked against the server payment ledger, projected without writes by availability GET, and expired atomically by successful allocation commits. Maintenance POST/DELETE requires `bookings` permission; browser schedule and legacy-rental writes are frozen. CMS section transactions preserve unrelated content/`bookingCounter` and reject stale conflicting sections. See [the scheduling flows](ARCHITECTURE.md#resource-identity) and [CMS identity/persistence details](CMS_ARCHITECTURE.md).

## Technology

Versions below are declared in [package.json](package.json).

| Layer | Implementation |
| --- | --- |
| Runtime | Node.js **22+**, npm and `package-lock.json` |
| Application | Next.js **16.4.5**, App Router, React **18**, TypeScript **5.7.3** |
| UI | Tailwind CSS **3.4**, shadcn-style/Radix primitives, Lucide icons, Inter |
| Identity | Firebase Authentication, email/password, server OTP email verification, optional Firebase link fallback |
| Database | Cloud Firestore; realtime browser subscriptions and server-side Admin SDK transactions |
| Transactional email | Server-only Nodemailer Gmail SMTP, Firestore outbox, protected Node worker |
| Uploads | Cloudinary through authenticated Next.js API routes |
| Reports / documents | Recharts, ExcelJS, DOCX preview, printable receipts/reports |
| Tour | Pannellum **2.5.6**, loaded from jsDelivr by the tour component |
| Verification | ESLint **9**, Vitest **4**, Firestore rules-unit-testing |

The active backend is Firebase plus Next.js route handlers. Supabase/chat socket stubs remain in the repository; they are not required services for the active setup.

## Local setup

### 1. Install dependencies

Use Node.js 22 or newer, then run from the project root:

```sh
npm ci
```

### 2. Configure the environment

Copy [.env.example](.env.example) to `.env.local` and fill in the values from your Firebase and Cloudinary projects. In PowerShell:

```powershell
Copy-Item ".env.example" ".env.local"
```

| Variables | Used by |
| --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase browser authentication |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Browser Firebase and server Admin SDK project selection |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`, `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | Firebase web configuration |
| `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` | Server-only Firebase Admin project identity and credentials |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Server-only upload/delete credentials |
| `NEXT_PUBLIC_PERF_TRACE` | Optional tracing: `1` enables performance logs, `0` disables them |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_APP_PASSWORD`, `EMAIL_FROM` | Server-only Gmail SMTP; sending remains disabled unless explicitly enabled |
| `APP_BASE_URL`, `EMAIL_SENDING_ENABLED`, `EMAIL_TEST_RECIPIENT_ALLOWLIST`, `EMAIL_TEST_RECIPIENT_ALLOWLIST_ONLY`, `EMAIL_MAX_ATTEMPTS` | Server-only notification URL, gate, preview allowlist, explicit production smoke-test restriction, and retry limit |
| `EMAIL_OTP_SENDING_ENABLED`, `EMAIL_OTP_STAGING_APPROVED`, `EMAIL_OTP_SECRET`, `EMAIL_OTP_EXPIRY_SECONDS`, `EMAIL_OTP_RESEND_COOLDOWN_SECONDS`, `EMAIL_OTP_PRODUCTION_APPROVED` | Independent server-only OTP gate, staging-test approval, HMAC secret, expiry/cooldown controls, and explicit production approval guard |
| `NEXT_PUBLIC_EMAIL_VERIFICATION_LINK_FALLBACK_ENABLED` | Explicit compatibility-only Firebase link fallback; OTP remains primary |
| `EMAIL_VERIFICATION_ENFORCEMENT_ENABLED`, `EMAIL_VERIFICATION_ENFORCEMENT_START_AT` | Server-only verification rollout gate and legacy-client boundary |
| `CRON_SECRET` | Server-only secret for `/api/internal/email-worker` and `/api/internal/email-diagnostics` |

Use the same Firebase project for the browser configuration and Admin credentials. The private key supports escaped `\n` newlines. `.env.local` is ignored by Git; keep actual credential values out of documentation and client code.

### Isolated local staging

Use `npm run dev:staging` to load **only** `.env.staging.local` for Firebase identity and email controls before starting Next.js. Before Next.js performs its own dotenv loading, the launcher shadows every key found in its dotenv candidates with empty sentinels, reapplies the approved staging values, clears the dedicated `.next-staging` development output, and rejects the production project `oneestela-ae9b5`. Next may still report `.env.local` as a discovered file; that status does not mean its values won. The launcher requires `ONEESTELA_ENV=staging`, explicit staging Admin credentials, forbids production OTP approval, and when OTP is enabled requires `EMAIL_OTP_STAGING_APPROVED=true`, one valid `EMAIL_TEST_RECIPIENT_ALLOWLIST` address, a strong OTP secret, and complete staging Gmail SMTP settings. Run `npm run dev:staging -- --check` for a sanitized configuration check without starting the app; run `npm run verify:staging-runtime` to verify the live browser/Admin identities and disabled email controls without account or data access. Keep staging Admin credentials, SMTP credentials, and OTP secrets in the ignored `.env.staging.local` using staging-only services; never copy production credentials.

Before staging can pass the guard, the owner must create/confirm the staging Firestore database, enable Firebase Authentication **Email/Password**, add the local/preview staging domains to Firebase Auth authorized domains, and create a staging-project service account with the minimum Admin SDK access required by the server. The reviewed `firestore.rules` and `firestore.indexes.json` also need a separately authorized deployment to `one-estela-place-staging`; this repository does not deploy them automatically. Do not seed production records or reuse production credentials.

### 3. Prepare Firebase and initial content

1. Enable **Email/Password** sign-in in Firebase Authentication and create a Firestore database.
2. Configure that project with [firestore.rules](firestore.rules) and [firestore.indexes.json](firestore.indexes.json). [firebase.json](firebase.json) points the Firebase CLI at these files; running Next.js does not deploy them.
3. Provision the first admin in Firebase Authentication and a matching `users/{uid}` Firestore document with `uid`, `fullName`, `email`, `role: "admin"`, `status: "active"`, and an ISO `createdAt`. There is no checked-in admin seed command. Public signup creates Client accounts only after successful OTP finalization.
4. Sign in as admin, open `/dashboard/cms`, and save the initial CMS configuration. The website can display fallback content without a stored document, but booking creation requires a persisted **`cms/data`** catalog.
5. Review the venue/office prices, capacities, rooms, payment details, policy copy, images, panorama/Virtual Tour entries, contract previews, and **Predefined Questions & Answers** in CMS. CMS-published entries override the existing built-in question set by status group; the built-in questions keep empty or partially configured client conversations usable until an administrator publishes replacements.

Staff accounts are managed from `/dashboard/staff` after the admin account is available.

### 4. Start the app

```sh
npm run dev
```

Open **http://localhost:3000**. Login and signup are dialogs on the public page. Signed-in clients are directed to `/portal`; admins and staff use `/dashboard`.

## Main routes

Next.js route-group names such as `(client)` and `(admin)` are filesystem organization, not URL segments.

| URL | Purpose / source |
| --- | --- |
| `/` | Public landing page: `app/(client)/page.tsx` |
| `/verify-email` | OTP-first pending signup finalization, plus six-digit verification/status/resend/sign-out and optional Firebase link fallback for existing signed-in Clients |
| `/portal` | Client dashboard with authenticated New Booking/Book Now navigation into the My Bookings reservation flow |
| `/portal/bookings` | Client booking list, responsive booking overview, and the existing reservation dialog; `newBooking=1` is a one-time UI auto-open intent |
| `/portal/payments` | My Transactions, responsive financial summaries, payment submissions, and receipts |
| `/portal/status` | Detailed booking/payment/contract status |
| `/portal/chat`, `/portal/profile` | Client support and profile |
| `/dashboard` | Admin/staff dashboard |
| `/dashboard/bookings`, `/dashboard/payments` | Responsive booking management and grouped payment verification |
| `/dashboard/chat`, `/dashboard/reports` | Support and reporting |
| `/dashboard/staff`, `/dashboard/cms` | Staff management and content settings |
| `/users` | Users Information, inside the admin route group |
| `/api/internal/email-worker` | `CRON_SECRET`-protected server-only email outbox worker; invocation scheduling is owner-configured outside this repository |
| `/api/internal/email-diagnostics` | `CRON_SECRET`-protected safe readiness booleans for owner troubleshooting; never returns credentials or recipient values |
| `/api/*` | Authenticated server endpoints; see [the API map](ARCHITECTURE.md#api-map) |

### Booking and payment list convention

The four booking/payment lists reuse `src/modules/shared/components/ui/table.tsx`, with one primary booking badge and unchanged canonical lifecycle/financial helpers. Admin payment and client transaction lists use compact records below `xl`; the Admin booking/payment desktop tables release their historical 1080px/1040px minimums at `xl` so all columns fit the available wide-desktop content area, while narrower wide-table states retain contained horizontal scrolling. The client transaction table retains its 1180px minimum where the wide renderer is used. Booking lists keep separate reference, event/business, resource, and schedule columns without repeating the client's own personal information. Admin payments remain grouped by booking: method/status views project relevant submissions, while complete history, receipt identity, and canonical balances remain attached to the same booking; visible method labels identify the concrete submission row rather than joining booking preference and ledger methods. Client transactions keep aligned Total, Received, Balance, and pending-review values with 44px actions and full submission/receipt details. Protected shells retain `min-h-0`, vertical content scrolling, and horizontal table scroll containment without blocking vertical chaining.

## Development commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local Next.js development server |
| `npm run build` | Production build |
| `node scripts/verify-safe-build.mjs --webpack` | Production compilation with a disposable demo identity, empty credential sentinels, disabled email, and loopback emulator endpoints; never deploy this output |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint, including existing warning-level rules |
| `npm run lint -- --quiet` | ESLint errors only |
| `npm run verify:staging-runtime` | Local runtime probe for staging-only browser/Admin Firebase identity and disabled email controls; no account or data access |
| `npx tsc --noEmit` | Type check |
| `npx vitest run` | Unit/API fixture tests; rules and real-Firestore availability suites skip without an emulator |
| `node --test scripts/start-staging.test.mjs` | Windows-safe isolated staging launcher tests |
| `node --experimental-strip-types scripts/verify-payment-flow.mts` | Canonical payment-flow regression harness |
| `node scripts/verify-payment-review.mjs` | Local Chromium payment-history, nested Venue Reviews, and scheduling UI regressions with responsive screenshots |
| `node scripts/verify-payment-review.mjs --payments-only` | Focused customer/admin historical-summary, method-filter, exact-receipt, selection, proof/note, and review-dialog regressions |
| `node scripts/verify-payment-verification.mjs` | Actual payment page/provider regressions for selected IDs, post-commit refresh failures, lost/malformed responses, permission errors, double-clicks, and customer/admin receipt agreement |
| `node scripts/verify-initialization.mjs` | Actual auth/booking providers, login dialog, protected layouts, account changes, empty/cache/error/permission/index-style read recovery, listener cleanup, and rapid/deduplicated availability requests; artifacts under `INITIALIZATION_TEMP_DIR` or the system temporary directory |
| `node scripts/verify-payment-submission.mjs` | Local Chromium payment-reference, proof/QR, and admin Booking Details responsive regressions with screenshots |
| `node scripts/verify-booking-maintenance.mjs` | Local-only Chromium maintenance regressions using the actual admin bookings page/provider at 1366×768, 1280×720, 390×844, and 320×568; override temporary artifacts with `BOOKING_MAINTENANCE_TEMP_DIR` |
| `node scripts/verify-office-availability.mjs` | Chromium occupied/reserved room disabling, Rooms 2–8 selection, lease transitions, full-term maintenance, refresh/error, bounded-search, and nested-dialog checks at the same four sizes; override temporary artifacts with `OFFICE_AVAILABILITY_TEMP_DIR` |
| `node scripts/verify-booking-details.mjs` | Real customer/admin Booking Details office/event, original/current schedule history, document grouping, cancellation/refund, one-region scrolling, action handlers, and conditional footer checks at 320, 375, 768, 1024, 1280, 1366, and 1440px; use `--no-screenshots` for DOM/layout checks only; override artifacts with `BOOKING_DETAILS_TEMP_DIR` |
| `node scripts/verify-cms.mjs` | Local-only Chromium checks of CMS venue, office/room, and Virtual Tour editors, contextual actions, destructive confirmations, keyboard focus, responsive overflow at 320/375/768/1024/1440px, and shared Radix ref-warning absence |
| `node scripts/verify-booking-table.mjs` | Local-only Chromium checks of Admin Booking Management creation-time ordering, filters/search/pagination/reset/realtime insertion, table wheel scrolling, horizontal containment, and desktop/tablet/mobile overflow |
| `node scripts/verify-admin-booking-actions.mjs` | Local-only Chromium checks of restricted direct modification/cancellation actions, disallowed-field absence, Keep/Confirm flows, role visibility, full-width contract/five-action grid geometry, unified Modify context/calendar/availability/time controls, Cancel/Escape/focus return, and 320/375/768/1024/1280/1366/1440px dialog fit |
| `node scripts/verify-report-print.mjs` | Local Chromium report checks for compact summary/detail layout at 320/375/768/1024/1280/1366/1440px, financial row/summary values, display-name search, typed sorting, pagination/page-size behavior, Excel column/totals/filter parity, the accessible default/cancel/with-charts/without-charts print flow, full filtered rows beyond pagination, print typography, dashboard exclusion, and A4 landscape PDFs for both modes |
| `node scripts/verify-dashboard-chat-notifications.mjs` | Local-only Chromium checks that the Admin Dashboard keeps Recent Bookings, Needs Attention, and Total Records without the removed Payment Position presentation, plus cursor-page chat loading, legacy-message visibility, 500+ unread presentation, Manila-time grouping, keyboard composition, scroll-anchor preservation, notification routing/retry, and responsive overflow |
| `node scripts/verify-hotfix-reliability.mjs` | Actual chat/notification providers and suggestion hook against local service fixtures: cache/server initialization, repeated loads, saved reminders after reload/relogin, identity isolation, existing history, rapid navigation, cooldown synchronization, index recovery, and five responsive widths; artifacts under `HOTFIX_TEMP_DIR` |
| `node scripts/verify-booking-navigation.mjs` | Local-only Chromium checks that Dashboard New Booking/Book Now navigate to `/portal/bookings` and auto-open the existing dialog, plus direct My Bookings behavior, loading/error compatibility, venue selection, query consumption, close/refresh/back-forward behavior, and responsive usability at 320/375/768/1024/1440px |
| `node scripts/verify-tour-contrast.mjs` | Local-only Chromium checks of public Take a Tour venue/office card foreground contrast, capacity/icon/description readability, active/inactive tabs, selected/hovered/focused/expanded states, preserved dark surface, and 320/375/768/1024/1440px widths |

There is no `npm test` script. Tests live in `src/modules/shared/lib/__tests__/`.

Run standalone TypeScript checking **after**, not concurrently with, a Next build: the build recreates the `.next/types` files included by `tsconfig.json`. The emulator command below uses one worker and a longer setup-hook deadline for cold rules compilation; assertions and business limits are unchanged.

The payment-review browser harness renders the actual admin/client pages and reservation dialog with in-memory provider/service fixtures, using the installed Playwright and Vitest's Vite dependency. It checks immutable historical summaries, paged/reordered ID-stable selection, method-specific history filters, exact receipt scope, no stale receipt empty states, note isolation, fresh review drafts, proof controls, responsive table/row entry points, and desktop/mobile layout at the requested widths. Reservation checks cover the single reviews close control, keyboard/focus/scroll behavior, parent state preservation, buffered start options, invalidated selections, and disabled Proceed. It uses a local sans-serif font fallback and writes screenshots/cache to a temporary directory (override with `PAYMENT_REVIEW_TEMP_DIR`). Install Playwright Chromium with `npx playwright install chromium` if needed, or set `PAYMENT_REVIEW_BROWSER_CHANNEL=chrome` / `msedge` to use an installed browser. It does not exercise live Firebase/API persistence or remote panorama loading.

The payment-verification harness keeps the actual `BookingProvider` and customer/admin payment pages, replacing only service boundaries. It loads no environment files and blocks live traffic. Synthetic saved-state/response fixtures cover a successful commit followed by a failing UI refresh, authoritative reconciliation after lost/truncated responses, duplicate clicks, exact submission selection, and full-proof receipts with compact booking projections. Screenshots and diagnostic evidence default to a temporary directory (override with `PAYMENT_VERIFICATION_TEMP_DIR`); it uses the same browser-channel override. Actual review-handler tests with real permission checks, optimistic transaction retries, SDK write validation, and a synthetic 1 MiB size boundary live in `src/modules/shared/lib/__tests__/payment-review-api.test.ts`; these do not replace emulator/live commit validation.

The initialization harness also loads no environment files and replaces only service boundaries. It checks one server-confirmed profile read per login, profile/data error recovery, cached-empty versus authoritative-empty results, permission-denied and failed-precondition read messaging, stale responses after account changes, role/permission refresh, listener reference counts, stable availability keys, shared GET cancellation, and obsolete month/room responses. `--baseline=<git-ref>` can replay that revision's auth provider for read-count diagnostics; it is not a live identity-provider login. Use the same browser-channel override as the other Chromium harnesses.

For request diagnostics, add `?perf=1` to a page (or enable `NEXT_PUBLIC_PERF_TRACE`). Client logs separate profile/token readiness, response time, first dataset snapshots, and calendar render commits. `/api/availability` returns `X-Request-Id` and `Server-Timing` for auth, catalog, scheduling/ledger reads, calculation, and total server time; the environment flag additionally enables server timing/count logs. No tokens or complete private documents are logged. Initialization and data-read errors provide Retry actions; a cached/failed read does not establish an empty database or an available schedule.

The payment-submission harness uses the real customer payment and admin booking pages with local provider fixtures and the portal's available content widths. It covers reference error timing, raw/long references, leading zeros, multiline-paste rejection, cash applicability, upload restrictions/previews, loading/duplicate protection, QR enlargement/focus return, wrapping values, single-region modal scrolling, and existing booking action dialogs. It checks widths 320, 390, 768, 1024, 1280, and 1440px. It uses a local sans-serif font fallback, the original local QR asset, and the same browser-channel override; artifacts/cache default to a temporary directory (override with `PAYMENT_SUBMISSION_TEMP_DIR`). It does not exercise live services or verify a physical banking-app scan. Reference unit/API regressions are in `src/modules/shared/lib/__tests__/payment-reference.test.ts` and run the actual submit handler against the transaction fixture.

The maintenance harness keeps the real booking-context async boundary, with deferred local-only responses and synthetic CMS/subscription fixtures. It verifies exact resource IDs/scopes, acknowledged saves/deletes, failure retention, filtered deletion targets, loading/errors, full-day booking conflicts, server-projected expiry, and stale availability-request cancellation. It loads no `.env` files and blocks live Firebase/API traffic; persistence/concurrency remain separate emulator checks. It uses the same Chromium installation/browser-channel override and a local Arial font fallback as the other browser harnesses.

The office harness uses the real reservation component, availability hooks/client, shared rules, and Radix dialogs with synthetic local service responses. It covers disabled occupied/reserved Room 1, independent Rooms 2–8, dated active legacy leases and booking-to-lease hand-off, pending cancellation, all three rental terms, building/full-term maintenance, cancellations/hold expiry, focus/30-second refresh, failed/malformed responses, finite maintenance searches with explicit later periods, and reachable final/nested-dialog controls. It loads no `.env` files and makes no live Firebase writes. Browser fixtures do not replace the actual-route transaction tests in `office-booking-api.test.ts` or the optional Firestore emulator suite.

The Booking Details harness renders the actual customer/admin bookings pages with local provider fixtures. It covers pending cancellation, approved cancellation with eligible/requested/completed refunds, ordinary office/event bookings, Manila-readable original/current schedule history, readable rental terms, long multiline/unbroken values, consolidated document rows and availability, client 44px responsive action rows with 12px gaps, admin 44px actions in a two-column grid from 640px (single-column below, 8px gaps), full-width contract signing, management-only footers (omitted without actions), admin Mark as Refunded, single close/scroll region, keyboard order, document/modify/payment handlers, and scroll-lock restoration including the existing receipt-to-details return behavior. On short phones the admin details/actions share one scroll region below the fixed header rather than reserving a tall sticky footer. It uses a local Arial font fallback and the same browser-channel override, loads no environment files, and blocks live service traffic. `--no-screenshots` skips image capture while retaining the DOM/layout/action checks and result report. It records existing shared React 18 ref-forwarding warnings separately from runtime errors; it does not validate deployed data or live refund processing.

The admin booking-action harness renders the actual Admin Booking Management page with local provider/auth/catalog fixtures. It verifies the restricted four-field direct-update surface, disallowed-field absence, direct Admin-only cancellation with a required reason and Keep Booking/Confirm Cancellation, updated booking state, and staff/client action visibility. The page also exposes the separate guarded unsecured-pending booking-rejection action. At 320, 375, 768, 1024, 1280, 1366, and 1440px it measures the crowded five-action state, full-width contract action, single-region scrolling, unified Modify context/calendar/status/time controls, footer reachability, keyboard focus, Cancel/Escape, and focus restoration. It blocks live traffic and performs no Firebase writes; API authorization, transaction, capacity, availability, schedule history, audit, rejection/payment notification, idempotency, and refund-separation coverage lives in `booking-payment-api.test.ts`. The booking-table harness additionally checks one primary badge per row and lifecycle-based filtering; the payment-review harness measures status alignment and unchanged financial values and exercises Review, View Details, Make Payment, and Settle Remaining Balance at the same five widths.

The report-print harness renders the actual reports page with local booking/CMS fixtures, verifies compact summary/detail layout and responsive containment at 320/375/768/1024/1280/1366/1440px, verifies received/booking-value/net-cash values in the dashboard and print rows, downloads and inspects the generated Excel workbook's headers/totals/filter metadata, exercises the accessible print-options dialog (including chart-default, cancel, and deliberate chart-free selection), confirms both modes preserve filters, summaries, and the complete filtered dataset beyond dashboard pagination, switches Chromium to print media, checks print-only report typography and dashboard exclusion, and writes A4 landscape PDFs for both modes to a disposable temporary directory. It loads no `.env` files or live services; use the same Chromium installation/browser-channel override as the other browser harnesses.

The dashboard/chat/notification harness renders the actual client/admin surfaces with local in-memory fixtures. It verifies semantic title/toolbars, the Client Dashboard Payment Overview and redundant header copy are absent, Recent Payments and My Transactions navigation remain, the Admin Dashboard keeps Recent Bookings, Needs Attention, and Total Records while its Payment Position presentation and helper note are absent, successful empty reads remain distinguishable from failed/partial/permission-denied reads, retry/recovery and account-scope isolation, deterministic chat send failure, bounded older-message loading with stable IDs, legacy timestamp visibility, notification read rollback, Manila timestamps and presentation-only message grouping, Shift+Enter composition, bounded `500+` unread presentation, invalid notification destinations, scroll-anchor preservation, and 320–1440px horizontal containment. It blocks external traffic and performs no Firebase/API writes.

The booking-navigation harness renders the actual client dashboard and My Bookings page components with local service fixtures. It asserts the Dashboard-to-My-Bookings `newBooking=1` navigation contract and automatic one-time `ReserveDialog` opening, keeps the dialog available while booking history is loading or failed, verifies successful empty-booking rendering and the empty-state Book Now action, selects a venue, preserves unrelated query parameters, checks close/refresh/back-forward/no-document-reload behavior, and checks the same entry points at 320/375/768/1024/1440px. It does not claim deployed Firebase or Vercel behavior.

Phase 5.2B keeps refund processing server-authoritative while exposing `refund_requested` only to administrators and staff with `bookings`; dashboard-only staff, payments-only staff, and clients remain excluded. Chat uses a latest bounded realtime page per client, cursor-based older pages, a bounded admin conversation index with a legacy lane for timestamp-less records, stable document-ID deduplication, and an explicit `500+` unread indicator when the bounded query may be incomplete. Canonical ordered/index failures remain visible and retryable rather than being replaced by equality-only history reads; permission failures are not broadened or retried as another authorization scope. The Client Chat composite index is declared locally but still requires deployment to `oneestela-ae9b5`; no production migration, index deployment, or dependency change was performed in this workstream.

Vitest includes route-level scheduling/payment regression checks using an in-memory transaction boundary (document-version retries and read-before-write enforcement). These exercise the actual route handlers but do not replace emulator/live Firestore transaction validation. `vitest.config.mts` resolves the application's import aliases for those tests.

To run both Firestore rules and real-Firestore availability transaction regressions with an installed Firebase CLI and compatible Java runtime:

```sh
firebase emulators:exec --only firestore --project demo-one-estela-place "npx vitest run src/modules/shared/lib/__tests__/firestore.rules.test.ts src/modules/shared/lib/__tests__/availability-emulator.test.ts --maxWorkers=1 --hookTimeout=60000"
```

Use only a **disposable local emulator**, never production or shared data. The CLI supplies `FIRESTORE_EMULATOR_HOST`; both suites reject anything except `localhost`, `127.0.0.1`, or `[::1]` with a valid port (1-65535), without a scheme/path. Fixed, separate demo projects (`demo-one-estela-place` for rules, `demo-one-estela-availability` for transactions) prevent parallel cleanup collisions; each suite clears its own fixture database. Availability integration uses fixture authentication and an in-memory dummy certificate, never `.env`/ADC/live credentials, so it validates real Firestore concurrency rather than live authentication. Without the host variable the emulator suites skip; that is not a validation pass. Application browser Firebase clients do not automatically connect to the emulator.

### Resource identity audit and migration

[`scripts/migrate-resource-identities.mts`](scripts/migrate-resource-identities.mts) audits `bookings`, `maintenanceRecords`, and `officeRentals` against the persisted `cms/data` catalog, including archived entries. **The default is DRY RUN.** It uses Firebase Admin directly with the three Admin/project environment variables listed above (including escaped private-key newlines); Admin access bypasses Firestore rules. It does not load application defaults or create catalog IDs from labels, room numbers, or render positions. `--help` works without credentials or a Firebase connection:

```sh
node --experimental-strip-types scripts/migrate-resource-identities.mts --help
node --env-file=.env.local --experimental-strip-types scripts/migrate-resource-identities.mts
```

Preflight and operator procedure:

1. Independently verify the effective environment's Firebase project, credential scope, and any `FIRESTORE_EMULATOR_HOST` override before connecting; existing shell variables take precedence over `--env-file`. Use an authorized operator and a read-only credential for the initial audit where possible. Keep environment/mapping files out of source control. Reports contain document paths and statuses only, never resource labels, user details, or financial data; still handle document IDs as sensitive operational metadata.
2. Review the dry run. Missing/invalid or duplicate catalog IDs block the entire run, including missing room IDs. Perform a separately reviewed, backed-up, one-time catalog repair first, assigning stable IDs based on verified resource identity, never generating them from labels or array positions. The CLI never writes `cms/data`. Catalog issue statuses identify `cms/data` and the affected entry type without printing labels or positions.
3. Unique exact ID or exact current/explicit `legacyNames` alias resolutions are eligible automatically. `ambiguous`/`unresolved` records require human verification against authoritative records and an explicit mapping JSON. Use exact stored catalog IDs, not labels. Office room IDs must belong to the specified office; omit `spaceId` (or set it to the office ID) only for a verified whole-building association. Venue `spaceId`, if supplied, must equal `venueId`. Mappings cannot override a different uniquely resolved resource. Unknown fields, missing documents, non-office rental targets, and invalid targets are rejected before any writes. Retained conflicting legacy references produce `verification-failed`, requiring a separate manual review, not a guessed rewrite.
4. Before **any** apply, take a restorable Firestore export/backup including `cms/data` and all three collections, verify the restore procedure, and arrange a maintenance window. Pause **all** booking, maintenance, rental, CMS and other affected document writes, background schedulers, integrations, and old browser/mobile clients; merely closing your own browser is insufficient. Re-audit in that window and re-verify the mappings. Independently check existing schedule conflicts, especially where a mapping associates a previously ambiguous/unresolved active record with a resource.
5. Apply only while those writers remain stopped, then dry-run again with the same mappings and inspect the results before resuming services. Exit `0` means the audit/apply completed without flagged records, `2` means manual action is required, and `1` means an operational/usage failure. Unmapped ambiguous/unresolved records are skipped with exit `2`; other eligible records can still be updated. Writes are per document, not an atomic collection-wide migration; interruption or failure can leave a partial apply. Re-audit before retrying or restoring from backup.

Example verified mapping file (replace the example document/catalog IDs after independent verification):

```json
{
  "bookings/BOOKING_DOCUMENT_ID": { "category": "office", "venueId": "OFFICE_ID", "spaceId": "ROOM_ID" },
  "maintenanceRecords/MAINTENANCE_DOCUMENT_ID": { "category": "office", "venueId": "OFFICE_ID" },
  "officeRentals/RENTAL_DOCUMENT_ID": { "category": "office", "venueId": "OFFICE_ID", "spaceId": "ROOM_ID" }
}
```

```sh
node --env-file=.env.local --experimental-strip-types scripts/migrate-resource-identities.mts --mapping verified-resource-mappings.json
# Only after backup, writer shutdown, mapping/conflict review, and a fresh dry run:
node --env-file=.env.local --experimental-strip-types scripts/migrate-resource-identities.mts --mapping verified-resource-mappings.json --apply --maintenance-window
```

Every `--apply` requires `--maintenance-window`, even without mappings. This flag is an **operator acknowledgement**, not an automated safety guarantee. Each eligible document is transactionally re-read alongside `cms/data`, re-resolved, checked against the intended exact resource and its proposed post-update resolution, and updated only when canonical values differ. A changed target is skipped. **The migration does not acquire shared schedule locks, detect overlaps, or provide a schedule-consistency transaction across records.** Keep writers stopped and review conflicts manually.

Only these canonical fields may change: bookings' `venueId`, `officeId`, `spaceId`, `bookingCategory`, `bookingType`, `isOfficeRental`; maintenance's `type`, `scope`, `venueId`, `officeId`, `spaceId`; rentals' `officeId`, `spaceId`, `officeSpaceId`. Venue `officeId` is normalized to an empty string; office building `spaceId` is its office ID. Display/label snapshots, dates, timestamps, statuses, receipt/payment fields and all payment/receipt documents remain untouched. Output is JSON lines of `{ "path": "collection/document-id", "status": "resolved-would-update" }` (mode goes to stderr); `mapped-*`, `*-unchanged`, and `*-updated` distinguish reviewed mappings, no-ops, and committed updates. No full SDK/parser error messages or document payloads are printed.

## Project map and maintenance

- `app/`: routes, layouts, API handlers, global CSS, and SEO metadata routes.
- `src/modules/client/`: reservation UI, client features, booking context, and catalog helpers.
- `src/modules/admin/`: CMS, staff, booking/payment management components and contexts.
- `src/modules/shared/`: auth, active chat/notifications, UI primitives, business helpers, and tests.
- `lib/`: browser Firebase, server Firebase Admin/auth, and older static data helpers.
- `components/`: mixed compatibility and older implementations; some are still imported.
- `public/`: images, placeholders, and publicly served contract previews.

Keep these references synchronized when changing routes, configuration, business flows, or visual conventions. Use the architecture's task-to-file map to avoid rediscovering the whole repository on each prompt.
