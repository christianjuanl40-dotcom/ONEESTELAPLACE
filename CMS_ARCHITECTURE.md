# CMS Architecture

Source reviewed: **2026-10-25**. The active CMS uses **Cloud Firestore**, with one shared **`cms/data`** document. See [ARCHITECTURE.md](ARCHITECTURE.md) for the overall system and scheduling invariants.

## Implementation map

| File | Responsibility |
| --- | --- |
| `src/modules/admin/contexts/cms-context.tsx` | `CMSData` types, defaults, normalization, snapshot subscription, and content mutations |
| `src/modules/shared/components/global-provider.tsx` | Mounts `CMSProvider` for all route groups |
| `app/(admin)/dashboard/cms/page.tsx` | CMS entry point at `/dashboard/cms` |
| `src/modules/admin/components/cms/` | Homepage, venues, offices, FAQs, policies, past clients, contracts, and payment editors |
| `src/modules/client/lib/venue-data.ts` | Normalized public catalog and in-memory venue/office cache |
| `src/modules/shared/lib/resource-identity.ts` | Exact resource IDs/categories, parent-scoped room resolution, and current/legacy aliases for all scheduling records |
| `src/modules/shared/lib/policies.ts` | Cached published policies and fallback policy text |
| `app/api/bookings/route.ts` | Reads the persisted CMS catalog and transactionally increments `bookingCounter` |
| `firestore.rules` | Public read and admin/CMS-staff content-write policy |

## Document shape

The `CMSData` interface lives in `cms-context.tsx`. Main sections:

| Field | Content |
| --- | --- |
| `homepage` | Hero, about, CTA, gallery, and FAQ headings/copy/images |
| `footer` | Brand name, description, email, phone, address, social links, and copyright |
| `venues` | Event catalog entries with stable IDs, category `venue`, `catalogStatus` (`published` or `under_renovation`), names/optional `legacyNames`, prices, capacities, short/full descriptions, images/panoramas, and optional booking configuration |
| `offices` | Category `office`, stable parent IDs/names/aliases, `catalogStatus` (`published` or `under_renovation`), short/full descriptions, and nested `rooms` with stable IDs/names/optional `legacyNames`; parent ID + room ID identifies the exact resource |
| `faqs` | Question/answer, order, visibility/archive metadata |
| `pastClientBookings` | Event gallery, client/testimonial data, photos, cover photo, display flag, and optional archive marker |
| `policies` | Policy type, title, content, publication flag, and timestamps |
| `eventVenueContract`, `officeRentalContract` | Contract file name, type, and URL |
| `paymentInfo` | Bank/account/instructions/optional QR code |
| `bookingCounter` | Additional persisted field used by server booking creation; not declared in the `CMSData` interface |

`CMSCatalogSpace` types the optional description fields while retaining existing catalog properties through an open index signature. Follow the editor, catalog normalization, availability helpers, and server validation together when changing the shape. In-code prices and contact/payment details are defaults, not confirmed live configuration.

### Catalog identity

- New venue, office, and room mutations assign fresh `crypto.randomUUID()` IDs after spreading caller data, including rooms supplied with a new office or added in bulk. Update helpers keep existing IDs immutable, force the parent array's category, and accumulate prior names in `legacyNames` without dropping earlier aliases. Room numbering in the editor suggests **labels only**, never IDs.
- Venue/office/room deletion archives entries rather than removing identity/aliases. Public lists hide archived entries, but the shared resolver retains them for historical associations and ambiguity detection. Exact IDs take precedence over historical display snapshots; legacy labels resolve only against exact current/registered aliases, with case/whitespace normalization, never substring/position matching.
- Room identity is scoped to its office. A duplicate alias/room ID is not resolved by catalog order: `ambiguous` or `unresolved` schedules require review, and affected scheduling APIs reject relevant blockers rather than guessing. Renames and room reordering do not replace a reservation dialog's selected resource ID. See [resource identity](ARCHITECTURE.md#resource-identity) for the exact rejection scope.
- There is **no CMS event-type catalog**. Reservation event/business-type options are local form choices plus Other/free text; `pastClientBookings.eventType` is per-gallery-entry text. Neither those values nor customer event names determine venue/office identity or availability.
- Past Client Bookings use `display: false` for an intentionally hidden but editable showcase entry. A confirmed delete marks only the selected entry with `isArchived`; CMS counts/lists and the landing page exclude archived entries, while photos and customer booking/payment records remain untouched.

Catalog publication is resolved by `getCatalogStatus()` in `src/modules/shared/lib/catalog-status.ts`. The canonical values are `published` and `under_renovation`; legacy `isHidden: true` and `Hidden` status values resolve to `under_renovation`, while missing status resolves to `published`. CMS writes keep `isHidden` synchronized for older clients. This is a lazy, repeatable compatibility mapping rather than a resource-recreating migration; archive flags and date-based `maintenanceRecords` remain separate.

### Expandable space descriptions

- Each venue/office stores `description` (the **Short Description**) and optional `detailedDescription` (**Expanded Description / Full Venue Details**) on its existing catalog entry.
- Both editors load these fields for editing and save through the existing add/update operations. Venue/office add/update operations return `Promise<boolean>`; editors show a saving state and close only after a successful Firestore write. Failed saves keep the draft open; the provider supplies success/error feedback.
- Existing panorama aliases are preserved when the panorama field is unchanged. Catalog updates merge the edited properties into the existing entry, retaining rooms and unrelated metadata.
- `venue-data.ts` and the tour's `normalizeSpaces()` preserve full text. `getDetailedDescription()` in `src/modules/shared/lib/space-description.ts` uses nonblank `detailedDescription`, falling back to `description` for older or blank records.
- The tour thumbnail, booking-card photo, and Schedule **About This Space** section use that same text with paragraph breaks preserved. Schedule descriptions read the current CMS entry by ID so an already-open booking view receives updates without changing its selected pricing/schedule data.
- The existing `cms/data` snapshot subscription distributes updates; no migration or additional persistence layer is needed.

## Read flow

```text
CMSProvider mounts
  -> onSnapshot(cms/data)
  -> normalizeCMSData(snapshot)
  -> setCmsData(normalized)
  -> setCachedPolicies(normalized.policies)
  -> setCachedVenuesAndOffices(normalized.venues, normalized.offices)
  -> public page, catalog, policies, and tour render shared content
```

Normalization merges homepage/footer/payment defaults and handles older gallery photo shapes. Explicit catalog, FAQ, policy, and gallery arrays, including empty or partial lists, remain authoritative: there are no hardcoded catalog-name exclusions or default entries appended to them. Missing arrays still use starter defaults; short FAQ lists are not padded.

**Legacy fallback exception:** `ensureBuiltinOfficeRooms()` still synthesizes numbered default rooms for `office-a`/`office-b` only when the `rooms` property is absent. An explicit `rooms: []` stays empty, and custom offices receive no generated rooms. This is not a blanket no-default-injection implementation: booking/availability/maintenance APIs read the raw persisted catalog and do not accept those fallback-only identities until explicitly saved.

If the document is missing, the provider displays defaults and populates the helper caches without creating a Firestore document. Server booking creation still requires the persisted catalog. A snapshot error falls back to default provider state and logs the error.

## Write flow

```text
CMS editor
  -> useCMS() mutation, e.g. updateHomepage or updateVenue
  -> saveCMSData(nextDocument)
  -> normalizeCMSData + stripUndefined; compare against provider state
  -> runTransaction: read latest cms/data and check changed top-level sections
  -> set(cms/data, changedSections, { mergeFields: changedKeys })
  -> after commit: local provider/cache refresh and success toast
  -> other connected clients receive Firestore snapshots
```

Writes are **CMS-owned section fields**, not full-document replacement. Existing documents receive only changed top-level sections; an explicit first save of a missing document writes all CMS sections. Unedited sections, unknown metadata, and the current server-managed `bookingCounter` survive concurrent saves. Arrays such as `offices` are still replaced as a section, not merged room by room.

Inside the transaction, every edited section is compared with the original provider section and the intended draft. If the latest section differs from both, `CMSConflictError` rejects the **whole save** with a **Content Changed** toast; no other draft sections are partially published. An already-identical draft is accepted, while stale sessions editing different sections can save independently. Structural comparison ignores map key ordering, not array ordering. Review fresh content after a conflict rather than retrying a stale section blindly.

`saveCMSData()` resolves to `true` after commit/cache refresh and `false` after a handled conflict/write failure. Venue/office add/update forms and office/room archive, room-edit, and bulk-add controls await this result before closing/resetting or showing success; failures retain their draft/confirmation. Older void helpers are not universally acknowledgement-aware: `deleteVenue` still returns immediately.

`useCMS()` exposes `cmsData`, section aliases, and mutation helpers. It does not expose the old `useVenues()`/`contentService` API or a dedicated `isLoading` field.

## Consumers and access

- The public landing page and footer read `cmsData` directly.
- Reservation UI uses CMS/catalog normalization; booking APIs independently read stored CMS data, resolve catalog status, and reject new allocations for `under_renovation` resources.
- The active tour is `src/modules/client/components/tour-button.tsx`, using CMS venue/office `panoImage` with an image fallback and Pannellum from the CDN.
- Policies are read through helpers that prefer cached, published CMS copy and otherwise return defaults.
- CMS navigation is available to admin users and staff with `cms` permission. Firestore rules enforce content writes; `cms/data` is publicly readable.

## Assets and contract previews

- `cms-image-upload.tsx` and shared Cloudinary helpers upload through authenticated `/api/cloudinary/upload` using `cms/...` folders; asset URLs are stored in the content document.
- Regular images and panoramas are separate fields; past-client galleries use photo arrays plus a cover photo.
- `/api/contracts` lists files from `public/contracts/venue` and `public/contracts/office` for authorized CMS users. Those static preview files are publicly served.
- CMS stores selected contract references in `eventVenueContract` and `officeRentalContract`.

When changing CMS behavior, verify the editor, Firestore document shape, affected public/portal consumer, server catalog validation, and the relevant documentation together.
