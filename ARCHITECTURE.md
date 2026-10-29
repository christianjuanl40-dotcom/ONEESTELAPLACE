# Architecture Design

Source reviewed: **2026-10-19** baseline; resource identity, scheduling, maintenance, and CMS persistence rechecked **2026-10-25**; exclusive office occupancy and customer/admin Booking Details rechecked **2026-10-26**; payment verification/persistence/recovery rechecked **2026-10-27**; Phase 1 authorization, cent-level payment validation, refund ledger checks, lifecycle idempotency, and password reauthentication rechecked **2026-10-28**. Start with [README.md](README.md) for setup and routes, and [DESIGN_PALETTE.md](DESIGN_PALETTE.md) for UI conventions.

## System shape

One Estela Place is a **modular Next.js application** with client, admin, and shared feature modules. It combines realtime browser reads with authenticated server APIs for booking/payment workflows. Some supporting features still write directly to Firestore under security rules.

```mermaid
flowchart TD
    Public[Public website]
    Client[Client portal]
    Admin[Admin and staff dashboard]
    Providers[React providers and feature components]
    WebSDK[Firebase browser SDK]
    API[Next.js API route handlers]
    Auth[Firebase Authentication]
    ServerAuth[Server token and profile checks]
    AdminSDK[Firebase Admin SDK]
    DB[(Cloud Firestore)]
    Media[Cloudinary]

    Public --> Providers
    Client --> Providers
    Admin --> Providers
    Providers --> WebSDK
    WebSDK --> Auth
    WebSDK -->|realtime reads and rules-checked writes| DB
    Providers -->|Bearer ID token| API
    API --> ServerAuth
    ServerAuth --> Auth
    ServerAuth --> AdminSDK
    API --> AdminSDK
    AdminSDK -->|transactions and authorized writes| DB
    API -->|upload and delete routes| Media
```

The server runs in the Next.js application; there is no separate backend service in this repository. APIs using Firebase Admin, Cloudinary, and contract filesystem access require a Node.js-capable deployment.

## Directory responsibilities

| Location | Responsibility |
| --- | --- |
| `app/(client)/` | Public `/` page; layout adds the contact-message provider |
| `app/portal/` | Client dashboard pages and authenticated navigation shell |
| `app/(admin)/` | Admin/staff navigation shell, `/dashboard/*`, and `/users` |
| `app/api/` | Server authentication, validation, transactions, and integration endpoints |
| `src/modules/client/components/` | Reservation dialogs, tour, contracts, and client feature UI |
| `src/modules/client/contexts/booking-context.tsx` | Booking/payment types, page-scoped subscriptions, action orchestration, and legacy normalization |
| `src/modules/client/lib/venue-data.ts` | Public catalog normalization and in-memory CMS catalog cache |
| `src/modules/admin/components/` | Booking/payment dialogs and `cms/` editors |
| `src/modules/admin/contexts/` | CMS and staff state; also older report/payment-proof adapters |
| `src/modules/shared/auth/` | Firebase auth context and login/signup UI |
| `src/modules/shared/contexts/` | Active Firestore chat and notification providers |
| `src/modules/shared/components/ui/` | Shared Radix/shadcn-style UI primitives |
| `src/modules/shared/lib/` | Shared business calculations, availability, permissions-related helpers, uploads, formatting, and unit tests |
| `lib/firebase.ts` | Browser Firebase app/auth/database initialization and IndexedDB cache |
| `lib/firebase-admin.ts`, `lib/server-auth.ts` | Server-only Admin SDK and API authorization |
| `firestore.rules`, `firestore.indexes.json` | Browser data-access policy and composite indexes |
| `public/contracts/` | Static venue/office contract previews |

Import aliases from `tsconfig.json`: `@/*` resolves from the repository root; `@admin/*`, `@client/*`, and `@shared/*` resolve into their feature modules. `components.json` retains older generator aliases, so use existing module imports as the reference when adding UI.

## Provider and state design

`app/layout.tsx` mounts `src/modules/shared/components/global-provider.tsx`:

```text
AuthProvider
├── PresenceTracker
└── ChatProvider                  shared/contexts/chat-context.tsx
    └── BookingProvider           client/contexts/booking-context.tsx
        └── NotificationProvider
            └── CMSProvider
                ├── route content
                └── Toaster
```

- The admin layout adds `StaffProvider` around its page content.
- The public `(client)` layout adds `MessageProvider` from `components/message-context.tsx`; that contact-message store uses localStorage and is separate from the active support chat.
- `AuthProvider` separates identity restoration, server-confirmed profile/permissions loading, ready/signed-out state, and initialization errors. `session-initialization.ts` coalesces login/listener profile reads and guards them by identity/generation; cancelled/late work cannot publish another account's state. Profile initialization fails closed for invalid roles/inactive profiles. Valid roles are `admin`, `staff`, and `client`.
- Pages opt into booking datasets through `useBookingData({ bookings, payments, officeRentals, maintenance })`. Only requested datasets have active listeners; hook cleanup unregisters exactly the datasets that caller requested.
- Booking/payment data is immediately masked and cleared when identity or relevant permissions change. Client queries use `userId` for bookings and `customerId` for payments; staff/admin queries depend on module access. One unordered listener per requested dataset includes legacy rows without date fields, with local presentation sorting; payments no longer require a duplicate recovery query. Stable need-count booleans prevent another consumer from restarting the same active listeners.
- Initial data readiness requires a server-confirmed snapshot (`includeMetadataChanges`); a cache-only empty event cannot finish loading. Dataset failures/initial-read deadlines expose `dataError`/`retryData`, with maintenance-specific state retained. Transient terminal listener failures get one bounded read resubscription; obsolete callbacks are ignored. `DataLoadNotice` provides recovery inside protected layouts without unmounting the requesting consumers.
- The maintenance listener has no `orderBy` or arbitrary oldest-500 limit: legacy rows without `createdAt` and old blocks covering future dates must remain visible. It exposes separate loading/error state; a failed listener is not an empty, available schedule.
- Full chat history is loaded through `loadChat()` and released with `unloadChat()`. Chat history and unread queries are bounded to 500 records. Notification queries are bounded to 100 records.
- Firestore's browser cache uses shared multi-tab IndexedDB persistence where available; the SDK can fall back to memory when persistence is unsupported. This avoids the reproduced single-tab exclusive-ownership warning. Cache contents never authorize a profile or confirm initial private data readiness.

## Identity and authorization

1. Browser sign-in uses Firebase Authentication email/password.
2. `getAuthHeaders()` in `src/modules/shared/lib/auth-token.ts` waits for Firebase identity restoration, attaches its ID token, and rejects token results from an obsolete identity. Safe-read waits are bounded/cancellable; booking/payment writes are never automatically replayed by this helper.
3. `requireAuthenticatedUser()` verifies the token, including revocation checks, and reads the current Firestore profile. Missing/invalid roles and inactive profiles are rejected.
4. `requireBackofficeUser()` adds admin/staff restrictions, module-permission checks, or `adminOnly` access.
5. Browser Firestore operations are independently enforced by `firestore.rules`. Firebase Admin bypasses those rules, so route handlers enforce authorization and ownership themselves.

Staff permission keys are `dashboard`, `bookings`, `chat`, `payments`, `reports`, `cms`, and `users`. Staff defaults enable only `dashboard`; staff administration is admin-only. Sidebar visibility and client redirects provide navigation behavior; API checks and Firestore rules enforce data access.

Login navigation uses the Next router after the profile is ready; logout invalidates session state and lets the protected guards navigate. Neither flow forces a page reload. `SessionInitializationNotice` distinguishes identity/profile loading from a genuine initialization failure and offers Retry/Sign out. Guard redirects wait for initialization and do not replace a profile error with a blank page or a signed-out redirect.

Browser rules deny booking creation/deletion and freeze canonical resource IDs, schedule/date/term fields, lifecycle/secured state, price, amount paid, and payment status for all roles, including admins. Permitted metadata-only edits remain. All browser writes to `maintenanceRecords` and the unused legacy `officeRentals` workflow are denied; allocation changes must use checked server APIs, not the retained browser lease editor.

Password changes stay client-side through `AuthProvider.updatePassword`: email/password accounts must provide a nonempty, different current/new password, reauthenticate with Firebase, and only then call `updatePassword`. Federated or passwordless accounts are rejected rather than being given a weaker flow. Email profile changes use the same recent-password requirement before the server profile update.

## Persistence and relationships

| Collection / document | Purpose and important links |
| --- | --- |
| `users/{uid}` | Profile, role, active status, staff permissions, contact details, and presence timestamp; matches Firebase Auth UID |
| `cms/data` | Public website content, venues, offices with nested rooms, policies, payment instructions, contract references, and `bookingCounter` |
| `bookings/{id}` | Venue or office reservation; owner is `userId`; resource identity uses `venueId`, `officeId`, and `spaceId` |
| `payments/{id}` | One document per payment submission; joins via `bookingId`/`bookingCode`, client owner via `customerId` |
| `receipts/{receiptNumber}` | Transaction receipts linked to a booking and, for the per-payment flow, a `paymentId` |
| `maintenanceRecords/{id}` | Full-day/date-range blocks with explicit `venue`, `room`, or `building` scope and canonical resource IDs |
| `eventAvailabilityLocks/{hash}` | Server-only resource revision locks: venue/date for events; `office:<parent ID>` / `all-dates` for every room in an office building |
| `chatMessages/{id}` | Client-scoped support messages, sender metadata, attachments, and read flags |
| `notifications/{id}` | Booking/payment updates; client UID or shared `"admin"` audience with permission-filtered staff access |
| `reviews/{id}` | Authenticated reviews; creation requires ownership of a completed booking |
| `officeRentals/{id}` | Legacy lease/check-payment records retained as availability inputs; browser writes are frozen |
| `paymentProofs/{id}`, `contracts/{id}` | Supporting/older document paths retained by components and rules |

Booking documents also retain `paymentReceipts`, a latest `receipt`, lifecycle/request metadata, and bounded admin logs. Payment/receipt joins use IDs and booking codes, not customer or venue display names. Historical records use multiple field/status shapes; shared helpers normalize them.

Uploaded asset URLs/public IDs are returned by Cloudinary. Some existing chat/proof paths also accept or store data URLs. Firebase Storage is present in web configuration but is not the upload backend used by the current upload APIs.

## API map

All paths below map to `app/api/<path>/route.ts` and require a Firebase Bearer ID token. Admin access satisfies staff permission checks.

| Endpoint | Methods | Responsibility / authorization |
| --- | --- | --- |
| `/api/availability` | GET | Authenticated, read-only schedule projection; sanitized intervals, office `scope=rooms` occupancy badges, optional full office term/bounded maintenance-start search, authorized self-exclusion, successful responses `private, no-store` |
| `/api/bookings` | POST | Client-only booking creation with catalog, date, capacity, room, price, and availability validation |
| `/api/maintenance` | POST, DELETE | Bookings permission: atomically create scoped full-day blocks or delete explicit record IDs; creation rejects schedule conflicts |
| `/api/bookings/lifecycle` | POST | `complete`, `status`, `contract_signed`, `balance_reminder`: bookings permission; `issue_receipt` and `expire`: owning client |
| `/api/bookings/cancellation` | POST, PATCH | Owning client requests cancellation; bookings staff/admin approve or decline |
| `/api/bookings/modification` | POST | Owner request; bookings staff/admin review or perform `admin_update` |
| `/api/bookings/refund` | POST | Owner requests a refund; bookings staff/admin complete it; both steps validate the received-money ledger and are idempotent |
| `/api/payments/submit` | POST | Client-owned payment submission, amount/type validation, proof/reference checks, and transaction receipt creation |
| `/api/payments/review` | GET, POST | Payments permission: POST reviews an explicit payment document; GET reads that submission's authoritative saved state for uncertain-response reconciliation (`private, no-store`) |
| `/api/payments/onsite` | POST | Bookings **or** payments permission: record and verify an onsite payment; the dashboard supplies an atomic retry key |
| `/api/profile` | PATCH | Update the authenticated user's email/phone; email changes enforce recent authentication |
| `/api/staff` | GET, POST, PATCH, DELETE | Admin-only Firebase Auth/profile administration |
| `/api/cloudinary/upload` | POST | Authenticated, folder-scoped upload with size/type/signature checks |
| `/api/cloudinary/delete` | POST | Authenticated, folder-scoped asset deletion |
| `/api/contracts` | GET | CMS permission: list static files under `public/contracts/venue` or `public/contracts/office` |

Contract listing is authenticated; the listed files themselves are public `/contracts/...` assets.

## Core data flows

### Resource identity

`src/modules/shared/lib/resource-identity.ts` is the shared resolver for bookings, maintenance, and legacy rentals. New scheduling inputs use `getCatalogAvailabilitySpace()` with exact category/catalog IDs; an office room is the **parent office ID + room ID**, not a name, room number, or array position. Provider update helpers preserve IDs and accumulate rename aliases; archived identities remain in resolution so archiving cannot erase history or break an ambiguous tie.

`resolveResourceSpace()` checks exact, case-sensitive IDs first, then exact current names or explicit `legacyNames` aliases (labels normalize case and whitespace). Child references are scoped to the established parent. It never uses substrings, ID prefixes, inferred room numbers, render order, or customer event titles. Category comes from explicit booking/rental metadata, `isOfficeRental`, or `officeId`; maintenance uses its explicit `type`, and legacy rentals are office resources. `eventType` is descriptive/custom text, not resource identity; the reservation form has built-in options plus Other/free text, not a CMS event-type catalog.

Resolution returns `resolved`, `ambiguous`, or `unresolved`, never the first plausible match. Server scheduling rejects blocking ambiguous candidates affecting the target, and unresolved records with an exact target parent/resource link, with **409** for administrator review. Office reservations/leases apply across all dates; event and maintenance conflicts retain date scoping. Unanchored unresolved records still need an audit, not a guessed association. See [the identity audit/migration procedure](README.md#resource-identity-audit-and-migration); it is not a live scheduling writer.

### Reservation and availability

1. `reserve-dialog.tsx` reads the current CMS catalog and keeps venue/office/room selection by ID, preserving identity across renames and room reordering. It requests availability through `availability-client.ts`.
2. `BookingProvider` sends booking input and auth headers to `/api/bookings`.
3. The server reads **persisted** `cms/data`, resolves the exact venue/office/room and catalog status, derives price/capacity, and validates the schedule. `under_renovation` venues and offices are visible catalog entries but cannot receive new allocations; an office-level block applies to every room.
4. A Firestore transaction checks bookings, maintenance, and relevant legacy office rentals through `readResourceAvailability()`, then atomically commits eligible hold expiries, advances `cms/data.bookingCounter`, and creates a `pending`, `unpaid` booking. `readResourceAvailabilityLock()` in `lib/event-availability-lock.ts` serializes booking creation, approved/admin modifications, and maintenance creation even when conflict reads were initially empty.
5. The server attempts an admin notification after creation. Scoped Firestore subscriptions refresh the client and dashboard.

Venue locks are per resource/date; venue maintenance ranges lock **every covered date**. Office locks use the parent building across **all dates and rooms**, so different rental start dates and room-versus-building maintenance still contend. This coarser office lock trades concurrency for correct term/building overlap checks; independent rooms can succeed after retry and recheck.

`lib/resource-availability.ts` deliberately scans complete, unordered collections of `bookings`, `maintenanceRecords`, and, for offices, `officeRentals`, then filters identity/dates. Until legacy migration is complete, narrow canonical-ID/date queries or limits could omit name-only, `startDate`-only, missing-`createdAt`, or undated rental records. **GET uses field projections** from `availability-read-fields.ts` to avoid transferring proof/receipt/profile payloads while retaining all identity aliases, lifecycle, time/term and hold-money inputs. Transactional writers still read full records, including historical audit logs. Ledger checks are pipelined with independent collection reads, and canonically protected holds avoid unnecessary ledger lookups using the same expiry predicate. No customer documents from those reads are returned by GET; do not optimize by dropping legacy blockers.

`getAvailabilityDateBounds()` in `availability.ts` prefers `date` over `startDate` and a persisted `endDate` over derivation. For office records with a recognized `officeRentalTerm`, `rentalTerm`, or `contractTerm`, it derives a missing end date using `getOfficeRentalEndDate()`: 6/12/24 calendar months, clamped to the destination month's last day. It does not invent an unknown term. Maintenance range endpoints are inclusive. **Ongoing office reservations and leases block their exact resource across all dates**, whether dated or undated; a planned/past end date never substitutes for an explicit lifecycle release. Canonical terminal states and server/ledger-approved unpaid hold expiry release only their own record; other reservations, leases, or maintenance still apply. Pending cancellation keeps occupancy.

The event schedule is fixed at **08:00–22:00**, exactly **6 hours** per reservation, with **hourly** starts (latest **16:00**). `hasEventTurnoverConflict()` in `availability.ts` requires exactly one **60-minute gap between bookings**, in either order; no extra hour is required after the final event. Catalog schedule overrides cannot bypass this event policy. The generic half-open overlap helper and office-exclusive lifecycle/date-scoped maintenance behavior remain separate.

GET `/api/availability` accepts at most 62 calendar dates and returns selected resource IDs plus per-date `status`, `availableSlots`, and `occupiedIntervals`. Event occupied intervals contain only numeric start/end minutes and formatted labels, sorted by start then end; no booking/payment/customer documents or their IDs leave the endpoint. Office/maintenance days have empty interval lists. Optional office `rentalTerm` evaluates the **entire term for each proposed start date**, not just that day. Successful responses send `Cache-Control: private, no-store`.

With an office `rentalTerm`, optional `searchFrom`/`searchTo` search at most **1096 inclusive start dates** separately from the 62-day visible calendar. GET reads maintenance through the last candidate's lease end and **all-date** office reservations/leases, applies ledger-based hold projection, and returns only `officeSearch: { from, to, earliestAvailableStartDate }` (date or `null`). Shared `findEarliestOfficeStartDate()` resolves exact parent/room IDs once, rejects ongoing reservations/leases, and jumps past conflicting inclusive maintenance ranges; `calculateAvailabilityRange(..., rentalTerm)` and allocation's `getAvailabilityRangeStatus()` use those same blocks. The shared `getMinimumBookingDate()` supplies the Manila one-calendar-month notice to search, form, and creation API, preserving the existing minimum-notice month rollover separately from clamped lease ends.

`use-office-room-availability.ts` fetches `scope=rooms` for the selected building before room selection. The server performs one complete building read and returns only `{ officeId, officeRooms: { [roomId]: status } }`: `available`, `reserved`, `occupied`, `maintenance`, or `unavailable`. Identity-review failures are isolated to affected room cards. Owner-scoped browser records cannot establish cross-customer availability. Reserved/occupied rooms stay visible and disabled, with no future-date flow; active legacy leases and canonical `active_rental` bookings remain blocked through contract signing/lease hand-off. Current maintenance and nonbookable rooms are also disabled. A newly blocked selected room clears pending confirmation and returns to room selection.

Available office selection starts with **6 Months** and opens the first month containing a valid complete term after date-scoped maintenance. The notice is **Earliest available start date**. Room/term changes recheck availability; invalid dates clear with an explanation. Manual previous/next navigation remains available. An empty maintenance search explicitly states its period and offers **Search later start dates**; each additional period is user-triggered and bounded. Both occupancy and calendar hooks invalidate on provider booking/maintenance/legacy-rental changes; other-session changes and clock-based hold expiry are picked up on focus and at 30-second polling. Failed/malformed responses keep selection/submission disabled. Creation and approved/admin modifications revalidate ongoing exclusivity and the complete term transactionally under the building-wide lock, including nonoverlapping future dates and stale tabs.

For maintenance, admins and staff with `bookings` permission may request a whole building by setting office `spaceId` to its parent `officeId`; this aggregates every room in that building. Ordinary clients must select an exact room and cannot use whole-building lookup.

An ordinary client may use `excludeBookingId` only for an existing booking they own; missing/foreign exclusions return 403. **Current backoffice exception:** admins and staff with `bookings` permission may also exclude an existing booking, so this is not globally owner-only. Modification validation excludes its own booking and rechecks on approval.

`use-space-availability.ts` refreshes visible schedules every 30 seconds and on focus. Under **SELECT TIME**, the reservation UI shows compact occupied times/available starts only for a selected event date with intervals; no date or a genuinely empty date has no notice/placeholder. Loading and failure are separate states, never evidence of availability. Invalid event times clear; Proceed requires a current valid schedule, including the selected office term. Booking creation requires at least **one calendar month in advance**, using the Manila date.

Availability hooks wait for profile initialization and use primitive resource/room/month/term/exclusion keys, rather than catalog/object identity. `availability-client.ts` shares only identical in-flight GETs by UID, request, and invalidation revision; one cancelled consumer cannot abort another, while the last cancellation aborts transport. There is no completed availability cache. Known booking/lease/maintenance changes use compact scheduling/hold keys, excluding large proofs/receipts/notes; a new revision cannot join an obsolete in-flight read. Responses must match the requested resource and contain the complete date range. GET recovery is bounded, failed/unloaded responses stay unavailable, and callers retain Retry actions. `Server-Timing`/request IDs and opt-in client traces separate authentication, transport/database, calculation, and render work.

### Pending hold expiry

`booking-lifecycle.ts` defines the **24-hour** window. `evaluateAvailabilityHolds()` checks the server clock and the actual `payments` ledger joined by booking ID/code, not just stale unpaid aggregates or a browser timer. Only abandoned `pending` holds with no received money, pending submission, or verified payment are eligible. Secured/admin-verified/contract-signed bookings and payment/cancellation/modification review holds remain protected, including incomplete payments with received money. Terminal states release according to `booking-helpers.ts` and `availability.ts`.

Availability GET applies expiry as a **read-only projection**, without writes or notifications. Successful booking creation, maintenance creation, and approved/admin modification commits persist eligible expiries only for the affected resource (all dates for exclusive offices; the affected date window for events), in the same transaction as allocation/locks: `status: "cancelled"`, system automatic-expiry audit fields, and `AUTO_EXPIRE_BOOKING`. Failed transactions and modification requests do not persist those projected expiries; there is no global expiry sweep here. The owning-client lifecycle `expire` action uses the same eligibility predicate. Payment submission/onsite recording reject expired or released holds; payment review, status, and contract signing cannot reactivate a released reservation. A new availability-checked booking is required.

### Maintenance

`/api/maintenance` POST/DELETE requires admin or staff **bookings** permission, not CMS permission alone. POST validates persisted IDs and explicit `venue`, office `room`, or whole-`building` scope, Manila today-or-later dates, and at most 180 covered days per request. It assigns fresh `maint_<UUID>` IDs and server label/audit snapshots; one transaction locks/checks all selected resources/dates before any writes. Any ongoing office reservation/lease, overlapping event booking/existing maintenance, duplicate batch entry, or relevant ambiguous/unresolved legacy identity rejects the **entire batch**, rather than cancelling reservations.

DELETE atomically removes up to 500 distinct explicit IDs, including unresolvable legacy entries; any missing ID rejects the batch. This limit bounds a mutation, not listener results. Fresh IDs prevent a stale delete from removing a later replacement block for the same date/resource. Provider actions validate the returned records/IDs before local changes; the management UI awaits acknowledgement before clearing drafts or showing success, retains failed drafts/selections, surfaces errors, and disables mutations when maintenance loading fails. Its resource options come from CMS, not `lib/central-data.ts`.

The maintenance calendar uses the same sanitized server GET, including ledger-checked hold expiry and legacy-identity errors, rather than guessing from locally loaded payment/booking data. Booking, rental, and maintenance snapshots invalidate its request immediately; stale responses are aborted. Selections retained across month navigation are rechecked before submission, and POST still validates every date transactionally.

Schedule Maintenance has a viewport-bounded flex shell, fixed header/close and Block Date footer, and one `min-h-0 overflow-y-auto` body around its fieldset. Paginated existing records use that body rather than a nested scroller. The shared non-plain dialog surface inherits its caller's height cap; Radix owns background scroll locking and nested-dialog restoration.

### Payments and receipts

1. A client selects bank transfer or onsite cash. Bank transfer includes proof and a reference number; online office payments are slot-reservation payments only. `payment-reference.ts` supplies the form, booking provider, and submit API with one string-only validator: trim surrounding whitespace, preserve leading zeros, and require at least five ASCII numeric digits with no reference-specific maximum. Letters, punctuation, and internal whitespace are rejected. Cash requires neither a bank reference nor bank proof. Successful reference validation only permits submission for admin review; it never verifies payment or secures a booking.
2. `/api/payments/submit` checks ownership, payable state, pending submissions, and current amount due inside a transaction.
3. Each submission gets a new `payments` record and a transaction-linked receipt. The receipt number is linked back to the payment; booking receipt history is retained.
4. `/api/payments/review` applies verification/rejection/incomplete transitions, updates that transaction's receipt and booking aggregates, and notifies the client. `/api/payments/onsite` handles staff-entered onsite receipts/payments. Each new finalized review atomically persists a versioned `reviewSnapshot` on the payment and its own receipt.
5. Client, admin, receipts, and reports derive financial values through shared payment/report helpers.

Review persistence and recovery (rechecked **2026-10-27**):

- Review reads the exact selected payment document and validates booking/customer association. Booking display codes are ledger aliases, not document-ID substitutions. Amount validation uses the selected submission, never a booking-level amount fallback. A rejected submission contributes zero; incomplete received money remains credited.
- A booking's `receipt` and `paymentReceipts` must not duplicate large inline proof images from each full snapshot: repeated data URLs can exceed Firestore's **1 MiB per-document limit** even with three submissions. `buildBookingReceiptProjection()` keeps new inline-proof entries' immutable summary/note metadata in `reviewSnapshotSummary` plus an exact `reviewSnapshotRef`; full proof/snapshot evidence stays on `payments/{id}` and `receipts/{receiptNumber}`. Earlier finalized entries are left intact. Shared presentation resolves these summaries without inventing historical values and prefers the exact canonical full proof when loaded. Later receipt issuance uses the same projection helper.
- Payment review completes all reads (including the selected receipt) before writes. One transaction updates the selected payment, booking ledger, and its exclusively associated receipt. Changed top-level maps are replaced so a previous latest receipt's full snapshot cannot leak through a recursive merge. Shared legacy receipt-number links cannot overwrite another submission's receipt; verified retries acknowledge saved state without writes/notifications.
- `payment-review-client.ts` coalesces in-flight reviews per payment. Lost/invalid/5xx responses trigger a permission-checked, noncached GET; a user-initiated retry after uncertainty checks saved state again before another POST. Cache/event refresh failures after acknowledgement are logged separately and cannot turn a successful review into an action failure. Safe API errors reach the modal; response request IDs correlate server diagnostics.
- Later verification/rejection/incomplete reviews preserve already secured bookings, advanced office lease stages, and separate modification/cancellation workflows. The original DP requirement remains consistent with the credited receipt ledger.

Payment-review presentation (reviewed **2026-10-22**):

- Finalized views pass the historical snapshot transaction to `payment-review.ts` for note resolution. Pending/legacy selections resolve by stable payment ID, with the authoritative payment document winning even when its note is empty/missing; booking-level incomplete/rejection notes are never per-submission fallbacks. A legacy projection can supply its own note only with a payment ID. `rejectionReason` is used only when that record's populated review states all say rejected.
- Admin and client use `use-payment-history-selection.ts` to pin selection by ID across new/reordered snapshots. A disappearing selection shows an unavailable state instead of selecting a different submission. Review action forms mount per booking/payment/action and begin with fresh drafts.
- `buildFinalizedPaymentSnapshot()` captures stable booking/payment IDs, review-finalization time, original submitted amount, credited amount, outcome, note, proof, booking price, and the complete post-review credited/DP ledger. It runs with the full server ledger, not a submitted-time prefix. Earlier snapshots are never recomputed when later payments arrive; verified retries return without writing.
- `getReceiptPresentation()` is the shared historical resolver for admin, client, and booking receipt views. It prefers the selected payment's snapshot, then its exact receipt's snapshot. Receipt matching requires booking identity plus payment ID (or an exact legacy receipt-number link), never array position, submission label, timestamp proximity, or the latest receipt. The review API requires an explicit payment document ID. Snapshots resolve independently of the loaded history page. New records persist display-only `paymentNumber` labels.
- Legacy finalized records expose only historical values actually stored on their own finalized receipt; missing amounts/DP values explicitly show **Unavailable**. Current payment statuses and current booking prices are never used to fabricate a legacy historical ledger. Later receipt issuance preserves an existing snapshot and does not backfill an invented one.
- `calculateReceiptPaymentSummary()` remains a live booking-wide **credited** ledger, including incomplete received money and the original DP requirement. Pending selections explicitly label those live totals **Current Booking Summary**. Finalized selections use **Historical Payment Summary**. `calculateBookingVerifiedPaymentSummary()` remains a verified-only diagnostic.
- `receipt-paper.tsx` shows the selected transaction's submitted/credited amounts, historical booking/DP summary, and emphasized Total Unpaid Balance. `payment-review-details.tsx` supplies the same proof/note cards to both views; finalized notes/proof come from that snapshot. Submission status is separate from current overall booking payment status.

**Canonical ledger rules** in `payment-calculations.ts`:

- `acceptedVerifiedTotal` counts verified records only.
- `moneyReceivedTotal` / `acceptedTotalPaid` also credit money recorded as received on **incomplete** submissions. Pending/rejected claims add no received money.
- Remaining balances and downpayment completion use that received-money ledger. Preserve the distinction between received money and officially verified money.
- Individual transaction statuses stay independent of the aggregate booking status. An old incomplete payment remains incomplete after a later payment covers the downpayment.
- Keep one receipt identity per payment in the per-payment flow. Preserve legacy no-payment-record fallback behavior.

Request and ledger safety (rechecked **2026-10-28**):

- `parseCurrencyToCents()` is the strict request parser: it accepts finite nonnegative numbers or trimmed peso/grouped decimal strings with no more than two decimal places, then rejects malformed, negative-sign, exponent, and nonnumeric inputs. The routes additionally reject zero and amounts above `MAX_PAYMENT_AMOUNT_CENTS`. `toPaymentCents()` is deliberately more tolerant only when reading legacy stored values; all new validation, balance comparisons, and ledger arithmetic use integer cents before converting back to Firestore-compatible numbers.
- Submit, review, and onsite routes re-read the booking/payment ledger inside their transactions. They reject expired/released holds, duplicate pending submissions, overpayments, invalid downpayments, and review amounts above the submitted/current due amount. Online office submissions remain slot-reservation-only. Onsite callers may omit `idempotencyKey` for legacy compatibility, but the dashboard creates and reuses a stable key across retries; when present, `paymentIdempotency/{sha256(bookingId,key)}` stores the request fingerprint and payment/receipt IDs in the same transaction, returning the original result without creating money or notifications twice.
- Cancellation approval and refund request/completion re-read payments by booking ID/code inside their transactions. The refund amount is initialized/capped to the canonical `moneyReceivedTotal` (including received incomplete money), rejects ledger inconsistencies, and records the ledger amount used. Ownership is required for client requests, bookings permission for completion, and already-requested/already-refunded states return without a second state change or notification.

### Lifecycle and action guards

`/api/bookings/lifecycle` keeps booking lifecycle separate from payment status and applies the following server-side guards transactionally:

- `complete` is idempotent and requires an active, availability-blocking booking with no remaining credited balance; released bookings cannot be completed.
- `status` is idempotent, allows only the supported secured states, rejects backward lifecycle movement and unresolved cancellation/modification workflows, and requires the payment threshold for the resource (downpayment for events, full payment for offices). `contract_signed` is also idempotent, requires a secured active booking, and moves an office to `active_rental`.
- `balance_reminder` records a one-time sent marker and requires a positive current balance. `issue_receipt` reuses an existing receipt, while client `expire` uses the same 24-hour/ledger hold predicate as availability and only releases an eligible pending hold. Notifications are emitted only after a transaction reports a real state change.

### CMS publication

Admin CMS editor -> `useCMS()` mutation -> normalize/strip undefined values and identify changed sections -> transactionally read `cms/data`, reject stale conflicting sections, and `set(..., { mergeFields: changedKeys })` -> provider/catalog/policy caches and Firestore snapshots -> public page, booking UI, and tour.

Only CMS-owned top-level sections are written, preserving concurrent unrelated content, unknown fields, and the server-managed `bookingCounter`. The stale-section check rejects the whole save if an edited section differs from both its original state and the intended draft; it does not merge individual room edits. CMS content is publicly readable; write access is controlled by Firestore rules for admin/CMS staff. Missing content is seeded only on an explicit save, not on mount. See [CMS_ARCHITECTURE.md](CMS_ARCHITECTURE.md) for identity, fallback, editor, and persistence details.

Venue/office entries include optional `detailedDescription` alongside the short `description`. Both catalog normalizers preserve it; `shared/lib/space-description.ts` supplies the shared nonblank-full-text/short-text fallback. Tour thumbnails and booking-card photos expand details through Radix Collapsible; booking progression stays on the Select button. Schedule's expandable details resolve the latest CMS description by the selected space ID. The venue/office editors await their existing add/update operations' save result before closing.

### Reports and analytics

`app/(admin)/dashboard/reports/page.tsx` reports only canonical `bookings` and their exact `payments` joins; it does not import legacy `officeRentals` data or monthly-rent/deposit/cheque records. Booking category and resource filters use explicit booking metadata plus `resource-identity.ts` resolution against the CMS catalog, retaining unresolved records in broad views without assigning them to a guessed resource. One filtered booking dataset drives summaries, charts, detailed rows, Excel export, and the existing print report. Office-only views leave the event-type chart non-applicable rather than treating office business-nature values as event types.

### Chat and notifications

- The active support chat is `src/modules/shared/contexts/chat-context.tsx`, mounted by `GlobalProvider`. Components write messages/read flags through the browser SDK and subscribe within the permitted client/admin scope.
- Portal chat pages and the portal widget manage the lazy conversation listener. Keep that lifecycle intact when changing chat surfaces.
- Quick replies and the checked-in chatbot knowledge are local rules/copy, with no external LLM integration configured.
- Notifications use `isRead` for the bell and `moduleRead` for module badges; read actions update both. Staff notification queries preserve permission-based type filtering.

## Business behavior to preserve

| Area | Implementation reference / invariant |
| --- | --- |
| Pricing | Server derives prices from stored CMS; default venue downpayment percentage is 50 when no valid override exists |
| Payment expiry | `booking-lifecycle.ts` + `lib/resource-availability.ts`: 24-hour server/ledger eligibility; GET projects without writes, successful scheduling transactions audit scoped expiry; secured/review/received-money holds stay protected |
| Cancellation | `cancellation.ts` requires a secured/paid booking, disallows terminal/duplicate requests and requests within 7 days, and handles cooldown/audit fields |
| Refunds | Cancellation approval helper uses a 14-day eligibility threshold and a 7-day onsite readiness date; preserve its current calculations unless policy changes are requested |
| Office rentals | One ongoing reservation/lease per exact parent/room across all dates and customers; terms are `6_months`, `1_year`, `2_years`; slot payment, physical contract signing, advance/deposit, and cheque tracking are distinct stages |
| Dates | Preserve date-only booking fields, ISO activity timestamps, and Manila-aware booking validation; inspect the relevant helper before changing date arithmetic |
| Statuses | `catalogStatus` (`published`/`under_renovation`), `status`, `bookingStatus`, `paymentStatus`, and request/contract statuses represent different concerns; use existing normalization and label helpers |

## Task-to-file map

Paths are relative to the repository root.

| Prompt concerns | Open first |
| --- | --- |
| Public page / header / footer | `app/(client)/page.tsx`, `src/modules/client/components/public-layout.tsx` |
| Client/admin navigation | `app/portal/layout.tsx`, `app/(admin)/layout.tsx` |
| Login / signup / profile | `src/modules/shared/auth/auth-context.tsx`, `src/modules/shared/lib/session-initialization.ts`, `src/modules/shared/lib/auth-token.ts`, protected layouts, `scripts/verify-initialization.mjs`, auth dialogs, `app/api/profile/route.ts` |
| Resource identity / aliases | `src/modules/shared/lib/resource-identity.ts`, `src/modules/admin/contexts/cms-context.tsx`, `src/modules/shared/lib/__tests__/resource-identity.test.ts` |
| Reservation / availability | `src/modules/client/components/reserve-dialog.tsx`, `src/modules/shared/hooks/use-space-availability.ts`, `src/modules/shared/lib/availability.ts`, `lib/resource-availability.ts`, `lib/event-availability-lock.ts`, `app/api/availability/route.ts`, `app/api/bookings/route.ts` |
| Maintenance | `app/api/maintenance/route.ts`, `app/(admin)/dashboard/bookings/page.tsx` (`MaintenanceCalendarModal`), `src/modules/client/contexts/booking-context.tsx`, `firestore.rules` |
| Hold expiry / released-state guards | `src/modules/shared/lib/booking-lifecycle.ts`, `lib/resource-availability.ts`, `app/api/bookings/lifecycle/route.ts`, `app/api/payments/`, `src/modules/shared/lib/__tests__/hold-expiry-api.test.ts` |
| Real Firestore scheduling verification | `src/modules/shared/lib/__tests__/availability-emulator.test.ts`, `src/modules/shared/lib/__tests__/firestore.rules.test.ts`, [combined local emulator command](README.md#development-commands) |
| Booking actions / status | `src/modules/client/contexts/booking-context.tsx`, `src/modules/shared/lib/booking-helpers.ts`, relevant `app/api/bookings/*/route.ts` |
| Client Booking Details | `app/portal/bookings/page.tsx`, `src/modules/client/components/booking-detail-fields.tsx`, `src/modules/client/components/booking-cancellation-details.tsx`, `scripts/verify-booking-details.mjs` |
| Booking Details action layout (customer/admin) | `src/modules/shared/components/booking-details-actions.tsx`, `app/portal/bookings/page.tsx` (Documents rows), `app/(admin)/dashboard/bookings/page.tsx` (management actions), `scripts/verify-booking-details.mjs`, `scripts/verify-payment-submission.mjs` |
| Payments / balances / receipts | `src/modules/shared/lib/payment-calculations.ts`, `src/modules/shared/lib/payment-verification.ts`, `src/modules/shared/lib/payment-review-client.ts`, `app/api/payments/`, portal/admin payment pages; `payment-review-api.test.ts` and `scripts/verify-payment-verification.mjs` for focused regressions |
| Payment reference / submission form | `src/modules/shared/lib/payment-reference.ts`, `app/portal/payments/page.tsx`, `src/modules/shared/components/bank-transfer-qr.tsx`, `app/api/payments/submit/route.ts` |
| Cancellation / refunds | `src/modules/shared/lib/cancellation.ts`, cancellation/refund API routes, cancellation dialogs |
| CMS / catalog | `src/modules/admin/contexts/cms-context.tsx`, `src/modules/admin/components/cms/`, `src/modules/client/lib/venue-data.ts` |
| 360 tour | `src/modules/client/components/tour-button.tsx`, `panoImage` fields in CMS; reservation previews also live in `reserve-dialog.tsx` |
| Expandable space descriptions | Tour/reservation components above, CMS venue/office tabs, `src/modules/shared/lib/space-description.ts`, `src/modules/client/lib/venue-data.ts` |
| Chat / unread counts | `src/modules/shared/contexts/chat-context.tsx`, relevant chat page/widget, `src/modules/shared/contexts/notification-context.tsx` |
| Staff / access control | `src/modules/shared/types/permissions.ts`, `lib/server-auth.ts`, `app/api/staff/route.ts`, `firestore.rules` |
| Reports / Excel / printing | `app/(admin)/dashboard/reports/page.tsx`, `src/modules/shared/lib/report-calculations.ts`, `app/globals.css` |
| Uploads | `src/modules/shared/lib/cloudinary.ts`, `app/api/cloudinary/`, feature-specific upload component |
| Shared styling | `app/globals.css`, `tailwind.config.ts`, `src/modules/shared/components/ui/`, [DESIGN_PALETTE.md](DESIGN_PALETTE.md) |

## Compatibility notes

- Root `components/` contains mixed implementations: `chat-context.tsx` is an older localStorage chat context, while the public contact `message-context.tsx` and payment-proof adapters still have imports. Trace imports before choosing or removing a file.
- `lib/central-data.ts` is an older static catalog, not the admin bookings/maintenance source; that page now uses CMS. `lib/mock-db.ts`, `src/modules/admin/contexts/report-context.tsx`, Supabase/socket stubs, and the alternate `virtual-tour.tsx` are not authoritative for the current server booking flow, reports, or CMS-driven tour.
- CMS policy text, defaults, and chatbot copy contain differing historical thresholds. Enforced server/helper behavior and published policy copy need to be traced together when a business-policy change is requested.
- CMS/profile/review/receipt paths retain some direct browser writes. Maintenance is server-only; legacy office-rental browser writers remain in source but are frozen by rules and are not the active booking path.
- CMS section transactions preserve `bookingCounter` and reject conflicting stale sections. Public normalization does not blacklist catalog names or append defaults to explicit empty/partial lists; missing-data fallbacks, including the legacy absent-room exception, are documented in [CMS_ARCHITECTURE.md](CMS_ARCHITECTURE.md#read-flow). Server scheduling never injects a default catalog.
- Test counts, lint counts, and audit notes in `IMPROVEMENTS.md` describe an earlier pass. Use current command output for current verification; a skipped emulator suite is not a rules validation pass.
