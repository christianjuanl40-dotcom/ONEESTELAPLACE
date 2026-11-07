# Design and Color Palette

Source reviewed: **2026-10-19** baseline; compact booking/payment tables rechecked **2026-11-03**; Phase 7.4 presentation refinements and protected shell scrolling rechecked **2026-11-04**; Phase 2.1 table scroll chaining, admin booking ordering, and lifecycle/payment presentation rechecked **2026-11-05**; Defense Polish 2.2 responsive/accessibility surfaces rechecked **2026-11-06**; Admin Dashboard Payment Position removal and natural content-flow cleanup rechecked **2026-11-07**. This is the project's visual reference for future UI work, based on the current public site, portal, dashboard, shared components, and CSS configuration.

Defense Polish 2 Admin Booking Management action surfaces and responsive cancellation confirmation were rechecked **2026-11-06**. Defense Polish 2.1 refines their layout with compact responsive admin actions, padded Modify forms, aligned payment statuses, and less page-header decoration; authorization, visibility, and financial behavior are unchanged.

Defense Polish 2.2 keeps the same workflows and tokens while refining semantic page toolbars, responsive Staff Management/Users Information records, loading/error announcements, and keyboard-accessible 360° tour controls. These are presentation and accessibility changes; status, payment, permission, and persistence behavior remain canonical.

Defense Polish 2.2.2 (**2026-11-07**) keeps the dark Take a Tour panel and orange branding while requiring light slate/white card copy on dark surfaces, readable icons/descriptions, and AA-safe active tab text. Venue/office capacity values remain CMS data; only foreground presentation changes.

The Admin Dashboard uses natural content height: its stat cards flow directly into the Recent Bookings and right-side action/Total Records cards without an empty toolbar spacer or the removed Payment Position mini-card group. Keep the shared admin shell's viewport-bounded layout unchanged for other protected routes.

**Follow-up (2026-11-07):** Notification titles wrap with timestamps beneath them, long messages use an accessible disclosure, and missing timestamps display `Date not recorded`. Client/admin payment surfaces use compact labeled records below `xl`; wide tables use flexible widths, centered uniform status badges, and active-only sort direction icons. Reports place controls and financial summary metrics in separate responsive cards.

Office occupancy badges and scheduling notices rechecked **2026-10-26**; customer/admin Booking Details button hierarchy refined **2026-10-27**; CMS responsive/accessibility surfaces rechecked **2026-11-05**. They reuse the existing compact orange/slate language.

## Visual direction

**Warm orange branding, white/slate workspaces, strong Inter headings, and rounded surfaces.** Public marketing sections add dark photography overlays; the client and admin areas share an orange header and light navigation/content surfaces.

- Use orange for brand emphasis, primary actions, selected navigation, and focus accents.
- Use slate/white for content hierarchy, forms, tables, and page structure.
- Reserve semantic colors for meaningful states such as verified, pending, cancelled, and completed.
- Keep booking/payment data readable with clear labels, consistent number alignment, and restrained decoration.

## Brand palette

These are Tailwind **3.4** default colors already used in the source. Prefer the named utilities over adding equivalent arbitrary hex values.

| Color | Hex | Existing role |
| --- | --- | --- |
| Orange 50 | `#FFF7ED` | Soft action hover, selected panels |
| Orange 100 | `#FFEDD5` | Brand icon tiles, pale badges, header secondary text |
| Orange 200 | `#FED7AA` | Soft brand borders/rings |
| Orange 300 | `#FDBA74` | Focus and hover borders |
| Orange 500 | `#F97316` | Selected-nav gradient start, accents |
| **Orange 600** | **`#EA580C`** | **Main brand/action color**, header, booking controls, chat bubbles |
| Orange 700 | `#C2410C` | Action hover, strong orange text, header gradient end |
| Orange 950 | `#431407` | Warm end of hero photo overlay |

Common existing combinations:

```text
Header:        bg-gradient-to-r from-orange-600 via-orange-600 to-orange-700
Active nav:    bg-gradient-to-r from-orange-500 to-orange-600 text-white
Brand action:  bg-orange-600 text-white hover:bg-orange-700
Soft action:   bg-orange-50 text-orange-700 border-orange-100
Dark action:   bg-slate-900 text-white hover:bg-orange-600
```

## Neutral palette

| Color | Hex | Existing role |
| --- | --- | --- |
| White | `#FFFFFF` | Cards, sidebar, dialogs, text on dark surfaces |
| Slate 50 | `#F8FAFC` | Portal/dashboard canvas, quiet form/section backgrounds |
| Slate 100 | `#F1F5F9` | Subtle dividers, muted tiles, disabled surfaces |
| Slate 200 | `#E2E8F0` | Card/input/table borders |
| Slate 300 | `#CBD5E1` | Stronger borders, disabled controls |
| Slate 400 | `#94A3B8` | Supporting icons, subdued metadata |
| Slate 500 | `#64748B` | Secondary text and chart axes |
| Slate 600 | `#475569` | Navigation and supporting body text |
| Slate 700 | `#334155` | Strong body text and form labels |
| Slate 800 | `#1E293B` | Dark controls, print table headers |
| **Slate 900** | **`#0F172A`** | **Headings, dark actions, public footer** |
| Slate 950 | `#020617` | Hero/loading backdrop and dark secondary CTA |
| Stone 50 | `#FAFAF9` | Alternate existing chat canvas |

## Semantic colors

Use the existing state mapping on the surface being edited. Typical light badges use a `50` background, `100` or `200` border, and `700` text; CMS badges often use a `100` background.

| Meaning | Main color | Light badge recipe | Examples |
| --- | --- | --- | --- |
| Success / secured | Emerald 600 `#059669` | `bg-emerald-50 text-emerald-700 border-emerald-100` | Confirmed, slot secured, verified/paid, published |
| Waiting / attention | Amber 500 `#F59E0B` | `bg-amber-50 text-amber-700 border-amber-100` | Payment review, partial balance, cancellation review |
| Booking pending / brand state | Orange 600 `#EA580C` | `bg-orange-50 text-orange-700 border-orange-100` | Pending/verifying booking badges, featured content |
| Destructive / declined | Rose 600 `#E11D48` | `bg-rose-50 text-rose-700 border-rose-100` | Cancelled, rejected, missing required content |
| Information / completed | Blue 600 `#2563EB` | `bg-blue-50 text-blue-700 border-blue-100` | Completed bookings and informational callouts |
| Contract action | Yellow 600 `#CA8A04` | `bg-yellow-50 text-yellow-700 border-yellow-100` | Contract signing required in My Bookings |
| Expired | Red 600 `#DC2626` | `bg-red-50 text-red-700 border-red-100` | Rental expired |
| Neutral / hidden | Slate 500 `#64748B` | `bg-slate-50 text-slate-600 border-slate-200` | Unknown, hidden, empty, inactive |

Unread badges use **Rose 500 `#F43F5E`** with white text. A state label/icon should communicate the meaning alongside its color. Booking lifecycle, schedule classification, individual payment status, and aggregate payment state are distinct; styling should reflect the correct one. Schedule badges use blue for upcoming/completed information, emerald for active timing, and slate for legacy or unavailable schedules. Pending payment submissions are labeled **Pending Verification**, while received/credited, verified, pending-review, and outstanding amounts remain separate values.

### Reports and chart colors

The reports page currently uses these explicit series colors:

| Series | Hex |
| --- | --- |
| Revenue / primary bars | `#EA580C` |
| Secondary series | `#0F172A` |
| Confirmed | `#10B981` |
| Pending | `#F59E0B` |
| Completed | `#3B82F6` |
| Cancelled | `#EF4444` |
| Other | `#94A3B8` |

Axes use slate 500; grid lines use slate 200. Keep chart legends and status labels consistent with the data grouping.

## CSS tokens and Tailwind configuration

[app/globals.css](app/globals.css) owns the HSL semantic variables; [tailwind.config.ts](tailwind.config.ts) maps them into utilities such as `bg-background`, `text-foreground`, and `border-border`.

**Important:** the existing `primary` token is neutral charcoal, while the visible orange brand is usually applied with explicit `orange-*` classes. `bg-primary` does not currently mean orange.

| Light token | Current value | Approximate hex / purpose |
| --- | --- | --- |
| `--background`, `--card`, `--popover`, `--sidebar` | `0 0% 100%` | `#FFFFFF` surfaces |
| `--foreground`, card/popover/sidebar foreground, `--ring` | `0 0% 0%` | `#000000` |
| `--primary`, `--sidebar-primary` | `0 0% 9%` | `#171717` |
| `--primary-foreground` | `0 0% 100%` | `#FFFFFF` |
| `--secondary`, `--muted`, `--accent` | `0 0% 96.1%` | `#F5F5F5` |
| `--secondary-foreground`, `--accent-foreground` | `0 0% 9%` | `#171717` |
| `--muted-foreground` | `0 0% 0%` | `#000000` for ordinary light-surface copy |
| `--border`, `--input`, `--sidebar-border` | `0 0% 89.8%` | `#E5E5E5` |
| `--destructive` | `0 84.2% 60.2%` | `#EF4444` |
| `--radius` | `0.625rem` | 10px at the default root size |
| `--sidebar-width`, `--sidebar-width-icon` | `16rem`, `3rem` | Shared sidebar primitive dimensions |

The `.dark` variable block exists, but the root provider does not mount the theme provider or expose an app-wide theme switch. Most feature surfaces explicitly use light slate/white classes. Dark marketing/tour panels are intentional local surfaces.

For a global color change, inspect both the semantic variables and explicit brand utilities. Document any token migration here when implementing it.

## Typography

- **Font:** Inter via `next/font/google` in `app/layout.tsx`, assigned to `--font-sans` and Tailwind `font-sans`/`font-heading`.
- **Loaded weights:** 400, 500, 600, and 700. Inter is the active root UI font across public, client, admin, CMS, authentication, dialogs, chat, tables, and reports.
- **Headings and headers:** 700 weight and solid black on light surfaces; white remains intentional on orange headers, hero/photo overlays, tours, chat bubbles, and the footer.
- **Body and information:** 400 weight and solid black on light surfaces, including descriptions, names, references, dates, times, financial values, table rows, form values, helper text, chat copy, and CMS content.
- **Interactive labels and statuses:** 600 weight by default for buttons, form labels, compact navigation labels, and badges. Semantic orange/blue/green/amber/rose colors and white text on dark/colored surfaces remain unchanged.
- **Small labels:** use concise 10–12px uppercase text sparingly for compact labels/metadata; avoid applying extended tracking to ordinary instructions or content.
- **Hero:** current heading scales from `text-2xl` to `sm:text-4xl md:text-6xl`.
- **Money and counts:** use Philippine peso formatting (`₱`, `en-PH`) and `tabular-nums` where numeric alignment matters.

## Layout and component language

| Element | Established pattern |
| --- | --- |
| Public content | Centered `max-w-7xl`/container, `px-4`, large section spacing, photo hero with dark overlay |
| Portal/admin header | `h-16` (64px), orange 600→700 gradient, white text and logo |
| Portal/admin sidebar | `w-64` (256px), white, slate 200 right border; off-canvas below `lg` |
| Workspace | Slate 50 background, white cards, slate borders, responsive padding |
| Cards | `rounded-xl`/`rounded-2xl`, `border border-slate-200`, optional `shadow-sm` |
| Primary CTA | Orange or dark slate with orange hover; `rounded-full`, `h-11`/`h-12`, bold text |
| Forms | `h-10`/`h-11`, `rounded-lg`/`rounded-xl`, slate borders, visible focus rings |
| Badges | Compact `rounded-md`/`rounded-full`, bold text, semantic background/border |
| Dialogs | Shared Radix primitive, white `rounded-2xl` surface, capped height, scrollable inner body |
 | Tables | Readable labels, approximately 5–7 intelligently grouped columns, compact consistent cells, wider identity/space columns, wrapped schedule/status content, full-width action allowance, aligned status/actions, flexible desktop widths without unnecessary minimums, contained horizontal overflow when needed, and labeled condensed rows below the wide-table breakpoint; Staff Management and Users Information use the same semantic table/card pattern |
| Icons | Lucide, usually `h-4 w-4` or `h-5 w-5`, `shrink-0` in compact flex rows |

Tailwind's configured `rounded-lg` is **10px**, `rounded-md` **8px**, and `rounded-sm` **6px** through `--radius`. Default `rounded-xl`/`rounded-2xl`/`rounded-3xl` remain 12px/16px/24px.

Default responsive breakpoints are `sm: 640px`, `md: 768px`, `lg: 1024px`, `xl: 1280px`, and `2xl: 1536px`. Keep mobile content usable with stacked actions, `min-w-0`, `min-h-0` on constrained flex ancestors, and inner scrolling instead of page-wide overflow.

### Phase 7.4 shared presentation classes

`app/globals.css` provides the shared `oe-*` classes used by the refined portal/admin surfaces. Use `.oe-page-kicker`, `.oe-page-title`, `.oe-page-description`, `.oe-section-heading`, and `.oe-section-description` for consistent hierarchy; use `.oe-table-head`, `.oe-table-label`, `.oe-table-primary`, and `.oe-table-secondary` for readable record cells. Financial cells use `.oe-financial-label` and `.oe-financial-value`; semantic states use `.oe-status-badge`; table actions use `.oe-table-actions` and `.oe-table-action`. Visually hidden `h1` elements remain required when a page's visible toolbar intentionally has no decorative title copy.

These classes are presentation-only and must not replace the canonical status, payment, booking, or permission helpers. The shared Button and Badge primitives provide the common orange keyboard-focus ring and disabled affordance; the Button `brand` variant is the shared solid orange action recipe; and the required-label `IconButton` primitive keeps icon-only actions named and focusable. The Table primitive provides readable cell spacing, wrapped content, row hover states, and contained horizontal scrolling. Preserve the mobile renderer's labeled compact-row layout rather than forcing page-wide table overflow.

The main client/admin Dashboard, booking, and payment pages use title-only, visually hidden `h1` headings without generic Client Portal/Operations eyebrows or descriptive subtitles. Necessary section headings, validation, and workflow instructions remain. The Client Dashboard omits Payment Overview and its explanatory note, but keeps Recent Payments and the My Transactions link. The Admin Dashboard keeps Recent Bookings, Needs Attention, and Total Records while omitting the presentation-only Payment Position group; its shared shell sizing remains unchanged. Staff Management and Users Information retain visible page titles because their record surfaces are not part of this title-only group.

The Reports financial table and CMS venue/office/tour catalog tables use the shared Table primitive where their specialized behavior permits it. Reports retain the same financial row projection for desktop cells and mobile disclosure details; sortable headers, page controls, and status badges remain presentation concerns.

Reports keep controls and financial summary metrics in separate responsive sections so filters remain usable without changing the report row projection or calculations.

### Reusable styling recipes

Import primitives from `src/modules/shared/components/ui/` and compose classes with `cn()` from `src/modules/shared/lib/utils.ts`.

```tsx
<Button className="h-11 rounded-full bg-orange-600 font-bold text-white hover:bg-orange-700 focus-visible:ring-orange-300">
  Submit Request
</Button>

<section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
  <h2 className="text-lg font-bold text-black">Booking Details</h2>
  <p className="mt-2 text-sm font-normal text-black">Reservation summary</p>
</section>

<span className="inline-flex items-center rounded-md border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
  Verified
</span>
```

## Interaction, layering, and print

- Reuse the shared dialog primitive for modal focus handling and consistent layering. Its overlay/content use `z-[10001]` / `z-[10002]`; the public header uses `z-[9999]`, and portal/admin headers use `z-50`.
- Portal/admin shells are viewport-bounded flex layouts: keep `min-h-0` on the outer shell, content row, and scrollable main pane, with `overflow-y-auto` only on the main pane. Side navigation remains its own `overflow-y-auto` region, and table horizontal scrolling stays inside the shared table container rather than becoming page-wide overflow; horizontal overscroll containment must not block vertical page chaining.
- Dialogs with a custom header close control opt out locally with `showCloseButton={false}`. Venue Reviews retains one 36px, explicitly named close button with an orange keyboard-focus ring. Radix owns nested focus/dismissal and scroll locking; avoid independent body-overflow effects that can leave stale locks after closing a child.
- Portal/admin mobile menu and notification controls retain named expanded state, `aria-controls` relationships, and the existing orange keyboard-focus language; notification items and chat image actions keep visible focus rings without changing their navigation or send behavior.
- Non-plain `DialogContent` defaults to a flex column capped at `calc(100dvh - 2rem)`; its internal surface inherits the caller's cap with `min-h-0 flex-1`. Keep header/footer `shrink-0` and one `min-h-0 flex-1 overflow-y-auto overscroll-contain` content region. Put fieldsets **inside** that region rather than making the fieldset the shrinking scroller. Schedule Maintenance keeps Block Date in the footer, reserves header room for Close, and paginates records within the single body. Keep native selectors or portaled dropdowns accessible without horizontal overflow.
- Preserve clear keyboard focus, explicit form labels, icon-button accessible names, disabled states, and text descriptions of errors/statuses. The 360° tour names its close, auto-rotate, zoom, reset, and fullscreen controls, exposes pressed state for toggles, labels the panorama region, and announces loading/error overlays without relying on icons alone.
- Session initialization uses a compact centered status/notice in protected layouts: distinct sign-in/profile loading text, an actionable error, orange Retry account loading, and outlined Sign out. Private dataset read errors use the existing rose bordered notice with an outlined Retry data loading action, keeping the requesting page mounted. Dashboard New Booking/Book Now uses the existing orange action styling while navigating to My Bookings; My Bookings keeps its orange trigger and controlled dialog mounted during loading or read-error states. Availability failures retain their local retry controls and disabled scheduling actions.
- Existing orange/white buttons use the brand palette; use orange 700 for small orange text on white when stronger contrast is needed, and check contrast when changing foreground/background pairs.
- Existing feedback uses short transitions, modest hover shadows, and small active scaling. Keep motion secondary to the booking/payment workflow.
- Venue/office descriptions use Radix Collapsible, an orange View Details/Hide Details or About This Space trigger, and a rotating chevron. `.space-description-content` animates content height in normal flow; reduced-motion preferences disable the animation and chevron transition. Preserve multiline text with `whitespace-pre-wrap` and keep expansion triggers outside panorama surfaces.
- Receipt printing is scoped by `.receipt-print` in `app/globals.css`. Report printing uses `[data-report-print-root]` plus its page-specific print styles; the Reports page presents a compact shared Radix dialog with accessible radio choices for chart-inclusive or chart-free output, and both need to remain legible on white paper.
- Payment review uses shared `payment-review-details.tsx`: equal, top-aligned proof/note cards with matching padding/headings; two columns when their content container is at least 28rem, natural stacked heights below that. Empty notes retain a neutral slate card with “No review note for this payment.”; only actual notes use subtle amber. Long notes/filenames wrap. Receipts distinguish **Historical Payment Summary** (with finalization time) from pending submissions' **Current Booking Summary**, show unavailable legacy values explicitly, emphasize the orange Total Unpaid Balance, and show the DP requirement separately with an included-in-balance explanation.
- Event time selection previews say **Selected 6-Hour Schedule** and retain both start/end times; selecting a schedule does not confirm a reservation.
- Availability notice recipe: directly under **SELECT TIME**, use the existing `rounded-lg border border-amber-100 bg-amber-50/60 p-3 text-xs` surface, bold slate headings, `tabular-nums text-slate-600` occupied ranges, and `text-orange-700` available starts. Show only sorted schedule labels, never customer/booking details. A selected event date with no occupied intervals, or no selected date, has no notice or empty placeholder; loading uses a separate `role="status"`, failure a `role="alert"`, and neither enables Proceed. Keep the same notice in desktop and mobile layouts.
- Office room cards retain reserved/occupied rooms with explicit badges and disabled actions; available sibling rooms remain independently selectable. Cross-customer occupancy is server-projected, with separate checking/error states. Only available rooms open the calendar. Calendar notices retain the orange surface, say **Earliest available start date**, include the full rental duration, and offer a link back to its month. Loading/errors never substitute the minimum lead-time date. Empty bounded maintenance searches show their period plus **Search later start dates**. Invalidated selections use a compact amber explanation.
- Admin payment-card action columns are compact (192px wide from `md`, full width on mobile), with three full-width, centered 32px elements and an 8px vertical gap: a semantic status badge, an orange Review button, and a neutral submission-count surface. They share 10px corner radii, 12px horizontal padding, 14px icons, and 6px icon/label gaps. Status labels may wrap within their line-height budget; no content-width wrappers or per-element alignment offsets.
- Admin Payment Verification and Client My Transactions table statuses use scoped `.oe-payment-status`: 32px high, 11rem wide, centered, nowrap labels with unchanged semantic colors. Desktop cells are centered vertically/horizontally; tables retain minimum widths (1040px admin / 1180px client) and horizontal scrolling rather than squeezing long statuses. Mobile compact rows put the badge beneath identity on narrow phones. Client `.oe-transaction-actions` keeps actions full-width within their column, at least 44px high with 8px gaps, and financial amounts stay right-aligned/tabular beside visible labels. No shared calculation or status classification is changed.
- Customer payment submission uses natural-height, top-aligned form/300px-summary columns from `xl`, stacking below that. Bank instructions, reference, and compact proof upload stay together beside the QR when their container has room. The original QR image is contained at up to 220px wide, with an enlargement dialog and original-image link; never crop or recompress it. The reference retains its required indicator but has no permanent helper or reserved feedback space. Errors appear after blur or a submit attempt, are associated with the input, and clear as soon as the value is valid.
- Booking Details actions share `src/modules/shared/components/booking-details-actions.tsx`. The default/client layout retains 44px controls, 8px (`rounded-md`) corners, 14px semibold labels, 16px icons, and 8px icon gaps. Default rows fill the available width with 12px gaps: one visible action fills the row, and multiple actions use equal-width columns from `md` (768px); below `md`, controls stack full-width in DOM order. Admin uses `BookingDetailsFooter layout="compact"`: 44px controls, 10px corners, 8px row/column/icon gaps, and two equal columns from 640px, one below. Modify is neutral, Cancel subtle rose, and the primary financial action orange. Omit the footer entirely without management actions. Header, body, and footer share 24px desktop / 16px mobile horizontal padding. The header remains fixed; at widths below 640px and heights at most 680px, details and actions share one scroll surface so a fixed footer cannot consume the viewport. Otherwise the footer remains outside the single details scroller.
- Default/client Booking Details button tones are scoped shared classes, leaving the global Button primitive unchanged: View Contract / View Receipt use `orange-50`, `orange-700` text, and `orange-200` borders; Download Contract uses `slate-50`, `slate-800` text, and `slate-300` borders; Cancel Booking uses `rose-50`, `rose-700` text, and `rose-200` borders. Modify Booking is the primary action. Default primary controls retain an `orange-600` base with a uniform `orange-700/75` tint, transitioning to `orange-700` on hover. Payment controls become soft orange beside Modify so one action remains dominant. Existing Request Refund/Mark as Refunded hierarchy remains. Default controls share 150ms color transitions, wrapping labels, a visible orange focus ring/white offset, reduced-motion support, and opaque slate disabled styling.
- Admin Booking Details has exact local footer colors independent of Button `default`/`outline` variants: Send Balance Reminder uses `#FFF7ED` / `#C2410C` with `#FED7AA` border and `#FFEDD5` hover; Record Onsite Payment uses solid `#EA580C` / white with a transparent border and `#C2410C` hover, with no gradient; Mark Contract as Signed uses `#F1F5F9` / `#334155` with `#CBD5E1` border and `#E2E8F0` hover. Their icons inherit the label color, all are shadow-free, and disabled slate styles/focus rings remain. When all three are available, retain reminder → onsite payment → contract signing order. Client/shared default colors are unaffected.
- Admin Booking Details uses a viewport-bounded flex dialog with one scrollable details region, compact header/footer, and a semantic 1/2/3-column information grid. Labels are quiet 12px text, values are emphasized 14px text with safe wrapping. Contract signing, cancellation/modification review, onsite payment, completion, reminders, and refunds retain their existing availability/disabled rules and share the management footer. Refund waiting/completed information and pending-payment explanations belong in the body. This modal currently has contract-status information but no document-view actions.
- Admin Booking Management exposes `Modify Booking` through the existing supported-field dialog for admins and staff with `bookings`; the server remains authoritative for capacity/availability and the dialog keeps the established responsive form treatment. Admin-only `Cancel Booking` uses the destructive rose tone and a viewport-bounded confirmation dialog with a required reason, `Keep Booking`, and disabled/loading `Confirm Cancellation`; it explains that refund processing remains separate. Hide the direct cancellation action for ineligible/request-review states rather than changing the shared Button primitive.
- Modify Booking has a 672px maximum width, 16px viewport margins, fixed padded header/footer, and one scrollable body; all three regions use 16px/24px horizontal gutters. Equal-width 44px tabs retain keyboard focus/selection. Labels are 14px semibold, inputs have consistent 44px sizing, and the calendar fits the available column without horizontal scrolling. Date/time/term dropdowns are locally layered above the dialog at `z-[10003]`; the global Select primitive is unchanged. Existing validation is also announced in an inline alert. Cancel/Escape returns focus to the visible originating booking-row action; successful saves keep the existing return-to-details behavior.
- Client Booking Details uses a 640px maximum-width flex shell capped at `100dvh - 2rem`, one `min-h-0 overflow-y-auto` body, and a fixed compact header. A prominent 18/20px title wraps to two header lines; its complete text remains in the body. Individual fields use a semantic single-/two-column `dl`, quiet 12px labels directly above **14px bold solid-black** values, and `overflow-wrap:anywhere`/multiline wrapping. Office fields say Office / Room, Rental Type, Rental Start/End Date, and human-readable terms; Time is event-only. Cancellation notices and audit/refund information belong in the body, with distinct stored activity labels and definitive workflow status. Boilerplate tentative eligibility guidance is suppressed once a definitive eligible/requested/refunded state exists; calculations and stored values remain unchanged. One compact **Documents** section holds Contract (existing signature status, View Contract / Download Contract) and Receipt (View Receipt) rows with shared content edges and a subtle separator. Document buttons fill rows beneath their existing labels using the shared equal-width/12px-gap action layout. Keep existing document visibility and signing instructions; when no contract file exists, retain its existing status/instructions separately without an empty document row. Receipt-only states have no footer; management/refund states use the shared footer above.
- The notification target highlight is orange `#EA580C` with a short zoom animation. Preserve the highlight's purpose when adjusting target cards.

## Where to look for visual examples

- Public brand/hero: `app/(client)/page.tsx`, `src/modules/client/components/public-layout.tsx`.
- Shared navigation: `app/portal/layout.tsx`, `app/(admin)/layout.tsx`.
- Reservation controls: `src/modules/client/components/reserve-dialog.tsx`.
- Status badges: `app/portal/bookings/page.tsx`, `src/modules/admin/components/cms/cms-status-badge.tsx`.
- Reports/charts/print: `app/(admin)/dashboard/reports/page.tsx`.
- Shared buttons/dialogs: `src/modules/shared/components/ui/button.tsx`, `src/modules/shared/components/ui/dialog.tsx`.

Update this guide alongside changes to the brand palette, fonts, tokens, shared shells, or component conventions.
