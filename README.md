# One Estela Place

Booking and rental management system for **One Estela Place**: event venue reservations, office room rentals, payment verification, customer support, and website content management.

Source reviewed: **2026-10-19** baseline; resource identity, scheduling, maintenance, and CMS persistence rechecked **2026-10-25**; exclusive office occupancy and customer/admin Booking Details rechecked **2026-10-26**; session initialization, read recovery, and availability performance rechecked **2026-10-27**. This documentation describes the checked-in implementation; live catalog values and provider configuration come from the connected services.

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
- **Admin dashboard:** booking management, payment review, onsite payment recording, reports and Excel export, staff administration, CMS, and user information.
- **Staff access:** dashboard features are controlled by per-module permissions.

The application roles are `admin`, `staff`, and `client`. An owner uses the admin role; `owner` is not a separate supported account role in the auth model.

Reservations use persisted CMS resource IDs and parent-office/room pairs, not display names or customer event types. Each office room permits only **one ongoing reservation/lease across all dates and customers**, checking both `bookings` and `officeRentals`; planned lease end dates do not release occupancy. Scheduling writers share resource locks and reject conflicts; abandoned unpaid 24-hour holds are checked against the server payment ledger, projected without writes by availability GET, and expired atomically by successful allocation commits. Maintenance POST/DELETE requires `bookings` permission; browser schedule and legacy-rental writes are frozen. CMS section transactions preserve unrelated content/`bookingCounter` and reject stale conflicting sections. See [the scheduling flows](ARCHITECTURE.md#resource-identity) and [CMS identity/persistence details](CMS_ARCHITECTURE.md).

## Technology

Versions below are declared in [package.json](package.json).

| Layer | Implementation |
| --- | --- |
| Runtime | Node.js **22+**, npm and `package-lock.json` |
| Application | Next.js **16.3.5**, App Router, React **18**, TypeScript **5.7.3** |
| UI | Tailwind CSS **3.4**, shadcn-style/Radix primitives, Lucide icons, Montserrat |
| Identity | Firebase Authentication, email/password |
| Database | Cloud Firestore; realtime browser subscriptions and server-side Admin SDK transactions |
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
| `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` | Server-only Firebase Admin credentials |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Server-only upload/delete credentials |
| `NEXT_PUBLIC_PERF_TRACE` | Optional tracing: `1` enables performance logs, `0` disables them |

Use the same Firebase project for the browser configuration and Admin credentials. The private key supports escaped `\n` newlines. `.env.local` is ignored by Git; keep actual credential values out of documentation and client code.

### 3. Prepare Firebase and initial content

1. Enable **Email/Password** sign-in in Firebase Authentication and create a Firestore database.
2. Configure that project with [firestore.rules](firestore.rules) and [firestore.indexes.json](firestore.indexes.json). [firebase.json](firebase.json) points the Firebase CLI at these files; running Next.js does not deploy them.
3. Provision the first admin in Firebase Authentication and a matching `users/{uid}` Firestore document with `uid`, `fullName`, `email`, `role: "admin"`, `status: "active"`, and an ISO `createdAt`. There is no checked-in admin seed command. Public signup creates client accounts.
4. Sign in as admin, open `/dashboard/cms`, and save the initial CMS configuration. The website can display fallback content without a stored document, but booking creation requires a persisted **`cms/data`** catalog.
5. Review the venue/office prices, capacities, rooms, payment details, policy copy, images, contract previews, and **Predefined Questions & Answers** in CMS. Starter question/answer records are shown for review but are not published until an administrator explicitly saves them with the desired entries enabled and published.

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
| `/portal` | Client dashboard |
| `/portal/bookings` | Client booking list and reservation actions |
| `/portal/payments` | My Transactions, payment submissions, and receipts |
| `/portal/status` | Detailed booking/payment/contract status |
| `/portal/chat`, `/portal/profile` | Client support and profile |
| `/dashboard` | Admin/staff dashboard |
| `/dashboard/bookings`, `/dashboard/payments` | Booking management and payment verification |
| `/dashboard/chat`, `/dashboard/reports` | Support and reporting |
| `/dashboard/staff`, `/dashboard/cms` | Staff management and content settings |
| `/users` | Users Information, inside the admin route group |
| `/api/*` | Authenticated server endpoints; see [the API map](ARCHITECTURE.md#api-map) |

## Development commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local Next.js development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint, including existing warning-level rules |
| `npm run lint -- --quiet` | ESLint errors only |
| `npx tsc --noEmit` | Type check |
| `npx vitest run` | Unit/API fixture tests; rules and real-Firestore availability suites skip without an emulator |
| `node --experimental-strip-types scripts/verify-payment-flow.mts` | Canonical payment-flow regression harness |
| `node scripts/verify-payment-review.mjs` | Local Chromium payment-history, nested Venue Reviews, and scheduling UI regressions with responsive screenshots |
| `node scripts/verify-payment-review.mjs --payments-only` | Focused customer/admin historical-summary, selection, proof/note, and review-dialog regressions |
| `node scripts/verify-payment-verification.mjs` | Actual payment page/provider regressions for selected IDs, post-commit refresh failures, lost/malformed responses, permission errors, double-clicks, and customer/admin receipt agreement |
| `node scripts/verify-initialization.mjs` | Actual auth/booking providers, login dialog, protected layouts, account changes, read recovery, and rapid/deduplicated availability requests; artifacts under `INITIALIZATION_TEMP_DIR` or the system temporary directory |
| `node scripts/verify-payment-submission.mjs` | Local Chromium payment-reference, proof/QR, and admin Booking Details responsive regressions with screenshots |
| `node scripts/verify-booking-maintenance.mjs` | Local-only Chromium maintenance regressions using the actual admin bookings page/provider at 1366×768, 1280×720, 390×844, and 320×568; override temporary artifacts with `BOOKING_MAINTENANCE_TEMP_DIR` |
| `node scripts/verify-office-availability.mjs` | Chromium occupied/reserved room disabling, Rooms 2–8 selection, lease transitions, full-term maintenance, refresh/error, bounded-search, and nested-dialog checks at the same four sizes; override temporary artifacts with `OFFICE_AVAILABILITY_TEMP_DIR` |
| `node scripts/verify-booking-details.mjs` | Real customer/admin Booking Details office/event, document grouping, cancellation/refund, one-region scrolling, action handlers, and conditional footer checks at 1366×768, 1280×720, 768×1024, 640×960, 390×844, and 320×568; use `--no-screenshots` for DOM/layout checks only; override artifacts with `BOOKING_DETAILS_TEMP_DIR` |

There is no `npm test` script. Tests live in `src/modules/shared/lib/__tests__/`.

The payment-review browser harness renders the actual admin/client pages and reservation dialog with in-memory provider/service fixtures, using the installed Playwright and Vitest's Vite dependency. It checks immutable historical summaries, paged/reordered ID-stable selection, note isolation, fresh review drafts, proof controls, and desktop/mobile layout. Reservation checks cover the single reviews close control, keyboard/focus/scroll behavior, parent state preservation, buffered start options, invalidated selections, and disabled Proceed. It uses a local sans-serif font fallback and writes screenshots/cache to a temporary directory (override with `PAYMENT_REVIEW_TEMP_DIR`). Install Playwright Chromium with `npx playwright install chromium` if needed, or set `PAYMENT_REVIEW_BROWSER_CHANNEL=chrome` / `msedge` to use an installed browser. It does not exercise live Firebase/API persistence or remote panorama loading.

The payment-verification harness keeps the actual `BookingProvider` and customer/admin payment pages, replacing only service boundaries. It loads no environment files and blocks live traffic. Synthetic saved-state/response fixtures cover a successful commit followed by a failing UI refresh, authoritative reconciliation after lost/truncated responses, duplicate clicks, exact submission selection, and full-proof receipts with compact booking projections. Screenshots and diagnostic evidence default to a temporary directory (override with `PAYMENT_VERIFICATION_TEMP_DIR`); it uses the same browser-channel override. Actual review-handler tests with real permission checks, optimistic transaction retries, SDK write validation, and a synthetic 1 MiB size boundary live in `src/modules/shared/lib/__tests__/payment-review-api.test.ts`; these do not replace emulator/live commit validation.

The initialization harness also loads no environment files and replaces only service boundaries. It checks one server-confirmed profile read per login, profile/data error recovery, cached-empty versus authoritative-empty results, stale responses after account changes, role/permission refresh, listener reference counts, stable availability keys, shared GET cancellation, and obsolete month/room responses. `--baseline=<git-ref>` can replay that revision's auth provider for read-count diagnostics; it is not a live identity-provider login. Use the same browser-channel override as the other Chromium harnesses.

For request diagnostics, add `?perf=1` to a page (or enable `NEXT_PUBLIC_PERF_TRACE`). Client logs separate profile/token readiness, response time, first dataset snapshots, and calendar render commits. `/api/availability` returns `X-Request-Id` and `Server-Timing` for auth, catalog, scheduling/ledger reads, calculation, and total server time; the environment flag additionally enables server timing/count logs. No tokens or complete private documents are logged. Initialization and data-read errors provide Retry actions; a cached/failed read does not establish an empty database or an available schedule.

The payment-submission harness uses the real customer payment and admin booking pages with local provider fixtures and the portal's available content widths. It covers reference error timing, raw/long references, leading zeros, multiline-paste rejection, cash applicability, upload restrictions/previews, loading/duplicate protection, QR enlargement/focus return, wrapping values, single-region modal scrolling, and existing booking action dialogs. It checks widths 320, 390, 768, 1024, 1280, and 1440px. It uses a local sans-serif font fallback, the original local QR asset, and the same browser-channel override; artifacts/cache default to a temporary directory (override with `PAYMENT_SUBMISSION_TEMP_DIR`). It does not exercise live services or verify a physical banking-app scan. Reference unit/API regressions are in `src/modules/shared/lib/__tests__/payment-reference.test.ts` and run the actual submit handler against the transaction fixture.

The maintenance harness keeps the real booking-context async boundary, with deferred local-only responses and synthetic CMS/subscription fixtures. It verifies exact resource IDs/scopes, acknowledged saves/deletes, failure retention, filtered deletion targets, loading/errors, full-day booking conflicts, server-projected expiry, and stale availability-request cancellation. It loads no `.env` files and blocks live Firebase/API traffic; persistence/concurrency remain separate emulator checks. It uses the same Chromium installation/browser-channel override and a local Arial font fallback as the other browser harnesses.

The office harness uses the real reservation component, availability hooks/client, shared rules, and Radix dialogs with synthetic local service responses. It covers disabled occupied/reserved Room 1, independent Rooms 2–8, dated active legacy leases and booking-to-lease hand-off, pending cancellation, all three rental terms, building/full-term maintenance, cancellations/hold expiry, focus/30-second refresh, failed/malformed responses, finite maintenance searches with explicit later periods, and reachable final/nested-dialog controls. It loads no `.env` files and makes no live Firebase writes. Browser fixtures do not replace the actual-route transaction tests in `office-booking-api.test.ts` or the optional Firestore emulator suite.

The Booking Details harness renders the actual customer/admin bookings pages with local provider fixtures. It covers pending cancellation, approved cancellation with eligible/requested/completed refunds, ordinary office/event bookings, readable rental terms, long multiline/unbroken values, consolidated document rows and availability, client 44px responsive action rows with 12px gaps, admin 56px full-width stacked actions with 10px gaps at every breakpoint, management-only footers (omitted without actions), admin Mark as Refunded, single close/scroll region, keyboard order, document/modify/payment handlers, and scroll-lock restoration including the existing receipt-to-details return behavior. It uses a local Arial font fallback and the same browser-channel override, loads no environment files, and blocks live service traffic. `--no-screenshots` skips image capture while retaining the DOM/layout/action checks and result report. It records existing shared React 18 ref-forwarding warnings separately from runtime errors; it does not validate deployed data or live refund processing.

Vitest includes route-level scheduling/payment regression checks using an in-memory transaction boundary (document-version retries and read-before-write enforcement). These exercise the actual route handlers but do not replace emulator/live Firestore transaction validation. `vitest.config.mts` resolves the application's import aliases for those tests.

To run both Firestore rules and real-Firestore availability transaction regressions with an installed Firebase CLI and compatible Java runtime:

```sh
firebase emulators:exec --only firestore --project demo-one-estela-place "npx vitest run src/modules/shared/lib/__tests__/firestore.rules.test.ts src/modules/shared/lib/__tests__/availability-emulator.test.ts"
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
