/** Real customer/admin booking pages in local Chromium, with synthetic providers.
 * No environment files, live services, or production data are loaded. */
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"
import tailwindcss from "tailwindcss"
import { chromium } from "playwright"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const output = await mkdtemp(join(process.env.BOOKING_DETAILS_TEMP_DIR || tmpdir(), "booking-details-"))
const modules = {
  state: `
    import {useSyncExternalStore} from 'react';
    import {buildCancellationRequestFields,buildCancellationApprovalFields} from '@/src/modules/shared/lib/cancellation';
    const noop=()=>{};
    const params=new URLSearchParams(location.search),office=params.get('category')==='office',pending=params.get('state')==='pending',active=params.get('state')==='active',admin=params.get('surface')==='admin';
    const receipt={receiptNumber:'LOCAL-RECEIPT',bookingId:'LOCAL-BOOKING',fullName:'Local Customer',dateIssued:'2026-10-20T04:00:00Z',amountPaid:10000,paymentAmount:10000};
    const booking={id:'LOCAL-BOOKING',userId:'CLIENT',venueId:office?'OFFICE':'VENUE',officeId:office?'OFFICE':'',spaceId:office?'ROOM':'VENUE',
      bookingCategory:office?'office':'venue',isOfficeRental:office,eventName:'Research and Community Partnerships — Annual Planning and Operations',eventType:office?'Technology and professional services':'Company Celebration',
      companyName:'International Research and Development '+('LongCompanyName'.repeat(10)),natureOfBusiness:'Technology, research, consulting and professional services',
      venue:office?'Ground Floor Office — Room 1':'The Milestone Event',date:'2099-03-01',endDate:office?'2099-09-01':'',startTime:office?'':'08:00',endTime:office?'':'14:00',guestCount:60,
      officeRentalTerm:office?'6_months':'',createdAt:'2026-10-19T04:00:00Z',totalPrice:10000,amountPaid:10000,paymentStatus:office?'slot_verified':'paid',isSlotSecured:true,
      status:active?'confirmed':pending?'cancellation_requested':'cancelled',bookingStatus:active?'Confirmed':pending?'Cancellation Under Review':'Cancelled',
      contractStatus:'Signed',contractSigned:true,contractSignedDate:'2026-10-20',receipt,specialRequests:'Please provide accessible room arrangements.\\n'+('Additional arrangements and guest considerations. '.repeat(10)),
      cancellationStatus:active?'None':pending?'Pending':'Approved',cancellationRequested:pending,cancellationRequestedAt:active?undefined:'2026-10-21T03:15:00Z',
      cancellationSource:'client',cancellationType:'client_request',cancellationActorName:'Fixture Customer',cancellationReason:'Our organization needs to adjust its long-term plans.\\n'+('ReasonWithoutSpaces'.repeat(30)),
      cancellationNotes:'Keep the receipt and contact management for processing. '+('Detailed review notes. '.repeat(12)),
      cancellationReviewedAt:pending||active?undefined:'2026-10-22T06:30:00Z',cancellationReviewedByName:pending||active?undefined:'Fixture Reviewer',cancelledAt:pending||active?undefined:'2026-10-22T06:30:00Z',cancellationApprovedAt:pending||active?undefined:'2026-10-22T06:30:00Z',
      refundStatus:active||pending?'Not Applicable':'eligible',refundEligible:!active&&!pending,refundAmount:active||pending?undefined:10000,
      refundReadyDate:active||pending?undefined:'2026-10-29T06:30:00Z',refundEligibilityNote:active?undefined:'May be eligible for refund',
      refundClaimNote:active||pending?undefined:'Refund may be claimed onsite in cash within the allowed processing period.',
      refundInstructions:active||pending?undefined:'Refund may be claimed onsite in cash within the allowed processing period.',refundMethod:'Cash',daysBeforeEventAtCancellation:active||pending?undefined:100,
    };
    let state={bookings:[booking],paymentRecords:[],maintenanceRecords:[],officeRentals:[],isLoading:false};
    const listeners=new Set();const publish=patch=>{state={...state,...patch};listeners.forEach(fn=>fn())};
    const patchBooking=patch=>publish({bookings:[{...state.bookings[0],...patch}]});
    const actions={getUserBookings:()=>state.bookings,requestRefund:async id=>{window.fixture.refunds.push(id);patchBooking({refundStatus:'requested',refundRequestedAt:'2026-10-26T04:00:00Z'})},
      issueReceipt:async()=>state.bookings[0],requestCancellation:async(id,reason)=>{window.fixture.cancellations.push({id,reason});patchBooking(buildCancellationRequestFields(state.bookings[0],reason,'2026-10-26T04:00:00Z',{actorName:'Fixture Customer'}));return state.bookings[0]},requestModification:async()=>{},addBooking:async()=>'',
      markAsRefunded:async id=>{window.fixture.completedRefunds.push(id);patchBooking({refundStatus:'refunded',refundedAt:'2026-10-30T04:00:00Z'})}};
    export function useBookingData(){const value=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>state);return {...value,...actions}}
    export const useBookings=useBookingData;
    export const user={id:'CLIENT',role:admin?'admin':'client',name:'Fixture Customer'};
    export const notifications={markByBookingId:noop};
    export const toast=noop;
    export const router={push:url=>window.fixture.navigation.push(url),replace:noop};
    window.fixture={patchBooking,snapshot:()=>state.bookings[0],refunds:[],completedRefunds:[],cancellations:[],navigation:[],approveCancellation(){patchBooking(buildCancellationApprovalFields(state.bookings[0],'2026-10-26T05:00:00Z',{name:'Fixture Reviewer'}))}};
    const nativeFetch=window.fetch.bind(window);window.fetch=(input,options)=>{const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.pathname.startsWith('/api/')||url.origin!==location.origin)throw Error('Unexpected live request');return nativeFetch(input,options)};
  `,
  booking: `
    export {useBookingData,useBookings} from 'virtual:details-state';
    import {evaluateCancellationEligibility,calculateCancellationDaysBeforeEvent,hasPendingCancellation} from '@/src/modules/shared/lib/cancellation';
    export {getOfficeRentalEndDate as calculateOfficeEndDate} from '@/src/modules/shared/lib/availability';
    export const canRequestCancellation=b=>evaluateCancellationEligibility(b).allowed;
    export const isCancellationAllowed=date=>calculateCancellationDaysBeforeEvent(date)>7;
    export const isRefundEligible=date=>calculateCancellationDaysBeforeEvent(date)>=14;
    export const getCancellationMessage=()=>'';
    export const canShowCancellationNotice=b=>b.isSlotSecured&&!hasPendingCancellation(b)&&!['cancelled','completed'].includes(b.status);
  `,
  auth: `import {user} from 'virtual:details-state';export const useAuth=()=>({user,isLoading:false})`,
  notifications: `import {notifications} from 'virtual:details-state';export const useNotifications=()=>notifications`,
   cms: `const contract=new URLSearchParams(location.search).has('noContract')?null:{fileName:'Local Contract.png',fileType:'image/png',fileUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY4sAAAAASUVORK5CYII='};const cmsData={venues:[],offices:[],officeRentalContract:contract,eventVenueContract:contract};export const useCMS=()=>({cmsData,offices:[],getOfficeRooms:()=>[]})`,
  toast: `import {toast} from 'virtual:details-state';export const useToast=()=>({toast})`,
  navigation: `import {router} from 'virtual:details-state';const params=new URLSearchParams(location.search);export const useRouter=()=>router;export const useSearchParams=()=>params`,
  firebase: `export const db={}`,
  token: `export const getAuthScope=async()=> 'LOCAL-FIXTURE';export const getAuthHeaders=async()=>({'Content-Type':'application/json'})`,
  firestore: `export const collection=()=>({}),query=ref=>ref,where=()=>({}),orderBy=()=>({}),limit=()=>({}),doc=()=>({}),getDoc=async()=>({exists:()=>false}),getDocs=async()=>({forEach(){}}),addDoc=async()=>({id:'LOCAL'})`,
  entry: `import React from 'react';import {createRoot} from 'react-dom/client';import Client from '@/app/portal/bookings/page';import Admin from '@/app/(admin)/dashboard/bookings/page';import '@/app/globals.css';import 'virtual:details-state';createRoot(document.getElementById('root')).render(React.createElement(new URLSearchParams(location.search).get('surface')==='admin'?Admin:Client));`,
}
const mocks = [
  [/\/client\/contexts\/booking-context(?:\.tsx)?$/, "booking"], [/\/auth\/auth-context(?:\.tsx)?$/, "auth"],
  [/\/contexts\/notification-context(?:\.tsx)?$/, "notifications"], [/\/admin\/contexts\/cms-context(?:\.tsx)?$/, "cms"],
  [/\/hooks\/use-toast(?:\.tsx?)?$/, "toast"], [/^next\/navigation$/, "navigation"], [/\/lib\/firebase(?:\.ts)?$/, "firebase"],
  [/(?:\/lib\/|^\.\/)auth-token(?:\.ts)?$/, "token"], [/^firebase\/firestore$/, "firestore"],
]
const server = await createServer({
  configFile: false, envFile: false, envDir: false, root, cacheDir: join(output, "vite-cache"), logLevel: "silent",
  define: { "process.env.NEXT_PUBLIC_PERF_TRACE": JSON.stringify("0") },
  server: { host: "127.0.0.1", port: 0 }, resolve: { alias: { "@": root, "@shared": join(root, "src/modules/shared") } },
  oxc: { jsx: { runtime: "automatic" } }, css: { postcss: { plugins: [tailwindcss({ config: join(root, "tailwind.config.ts") })] } },
  optimizeDeps: { noDiscovery: true, include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react", "clsx", "tailwind-merge", "class-variance-authority", "jszip", "docx-preview",
    "@radix-ui/react-dialog", "@radix-ui/react-visually-hidden", "@radix-ui/react-select", "@radix-ui/react-collapsible", "@radix-ui/react-slot", "@radix-ui/react-label", "@radix-ui/react-checkbox", "@radix-ui/react-progress", "@radix-ui/react-tooltip", "@radix-ui/react-tabs"] },
  plugins: [{ name: "local-booking-details", enforce: "pre", resolveId(source) {
    if (source.startsWith("virtual:details-")) return `\0details-${source.slice("virtual:details-".length)}.tsx`
    const mock = mocks.find(([pattern]) => pattern.test(source.replaceAll("\\", "/")))
    if (mock) return `\0details-${mock[1]}.tsx`
    if (/^(firebase|firebase-admin)(\/|$)/.test(source)) throw Error(`Unstubbed Firebase import: ${source}`)
  }, load(id) { return modules[id.match(/^\0details-(.+)\.tsx$/)?.[1]] }, configureServer(vite) {
    vite.middlewares.use(async (request, response, next) => {
      if (!request.url?.startsWith("/__details")) return next()
      response.setHeader("Content-Type", "text/html")
      response.end(await vite.transformIndexHtml(request.url, '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--font-sans:Arial,sans-serif}body{min-height:200vh;background:#f8fafc}</style></head><body class="font-sans"><main style="padding:16px"><div id="root"></div></main><script type="module" src="/@id/__x00__details-entry.tsx"></script></body></html>'))
    })
  } }],
})

let browser, page, current, failure
const passed = [], errors = [], warnings = []
const captureScreenshot = async options => {
  if (!process.argv.includes("--no-screenshots") && page) await page.screenshot(options)
}
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true, channel: process.env.PAYMENT_REVIEW_BROWSER_CHANNEL || undefined })
  const context = await browser.newContext({ locale: "en-US", timezoneId: "Asia/Manila", deviceScaleFactor: 1, serviceWorkers: "block" })
  await context.route("**/*", route => {
    const url = new URL(route.request().url())
    return url.origin === origin || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort()
  })
  page = await context.newPage()
  page.on("pageerror", error => errors.push(error.message))
  page.on("console", message => {
    if (message.type() !== "error") return
    const text = message.text()
    if (text.startsWith("Warning: Function components cannot be given refs.")) warnings.push(text.split("\n")[0])
    else errors.push(text)
  })
  const modal = () => page.getByRole("dialog").filter({ has: page.locator("[data-booking-details-body]") })
  const field = label => modal().locator("dl > div").filter({ has: page.getByText(label, { exact: true }) }).locator("dd")
  const actionStyle = async (action, stacked = false) => {
    assert.deepEqual(await action.evaluate(el => {
      const s = getComputedStyle(el)
      return [s.height, s.borderRadius, s.fontSize, s.fontWeight, s.columnGap, s.justifyContent, s.alignItems]
    }), [stacked ? "56px" : "44px", stacked ? "12px" : "8px", "14px", "600", stacked ? "10px" : "8px", "center", "center"])
    assert.equal(await action.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, "button labels fit without horizontal overflow")
    for (const icon of await action.locator("svg").all()) {
      assert.deepEqual(await icon.evaluate(el => { const s = getComputedStyle(el);return [s.width, s.height, s.marginRight] }), ["16px", "16px", "0px"])
    }
  }
  const equalWidthActions = async (actions, { x, width }, stacked = false) => {
    const buttons = await actions.all(), first = await actions.first().boundingBox()
    const columns = !stacked && page.viewportSize().width >= 768 ? buttons.length : 1
    const expectedWidth = (width - 12 * (columns - 1)) / columns
    let previous
    for (const [index, action] of buttons.entries()) {
      await actionStyle(action, stacked)
      const box = await action.boundingBox()
      assert.ok(Math.abs(box.width - expectedWidth) < 1, "visible actions equally fill the available width without empty columns")
      assert.ok(Math.abs(box.x - x - (columns > 1 ? index * (expectedWidth + 12) : 0)) < 1, "actions use the full row starting at its left edge")
      if (columns > 1) assert.ok(Math.abs(box.y - first.y) < 1, "desktop actions align vertically")
      else if (previous) assert.ok(Math.abs(box.y - previous.y - previous.height - (stacked ? 10 : 12)) < 1, "stacked actions retain their intended vertical gaps")
      previous = box
    }
  }
  const footerArrangement = async (expected, dialog = modal()) => {
    const footer = dialog.locator("footer"), actions = footer.getByRole("button")
    if (!expected.length) {
      assert.equal(await footer.count(), 0, "omit the footer when no management actions are available")
      return
    }
    assert.equal(await footer.count(), 1)
    assert.deepEqual((await actions.allTextContents()).map(text => text.trim()), expected, "footer contains management actions in logical order")
    assert.equal(await footer.getByRole("button", { name: /View Receipt|Contract$/ }).count(), 0, "document actions never appear in the footer")
    const footerBox = await footer.boundingBox()
    const padding = await footer.evaluate(el => { const style = getComputedStyle(el);return { left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight) } })
    assert.equal(padding.left, page.viewportSize().width >= 640 ? 24 : 16)
    const stacked = await dialog.getByRole("region", { name: "Booking details content", exact: true }).count() > 0
    await equalWidthActions(actions, { x: footerBox.x + padding.left, width: footerBox.width - padding.left - padding.right }, stacked)
    const dominant = await actions.evaluateAll(nodes => nodes.filter(el => !el.disabled && getComputedStyle(el).color === 'rgb(255, 255, 255)').length)
    assert.ok(dominant <= 1, "at most one visually dominant primary action")
  }
  const documentsArrangement = async () => {
    const body = modal().locator("[data-booking-details-body]")
    const section = body.locator("section").filter({ has: page.getByRole("heading", { name: "Documents", exact: true }) })
    assert.equal(await section.count(), 1)
    const sectionBox = await section.boundingBox()
    for (const row of await section.locator("[data-booking-document]").all()) {
      const label = await row.getByRole("heading").boundingBox(), buttons = row.getByRole("button")
      assert.ok(Math.abs(label.x - sectionBox.x) < 1, "document labels share the same left content edge")
      await equalWidthActions(buttons, sectionBox)
      for (const action of await buttons.all()) {
        await actionStyle(action)
        assert.equal(await modal().getByRole("button", { name: await action.textContent(), exact: true }).count(), 1, "each document action is rendered once")
        const box = await action.boundingBox()
        assert.ok(box.y >= label.y + label.height + 12, "document actions fill their own row beneath the existing labels")
      }
    }
  }
  const geometry = async () => {
    const dialog = modal(), viewport = page.viewportSize(), box = await dialog.boundingBox()
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, "dialog must fit viewport at 100% zoom")
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false)
    assert.equal(await dialog.getByRole("button", { name: "Close", exact: true }).count(), 1)
    assert.equal(await dialog.locator("footer").getByText(/awaiting|processing|cancellation request/i).count(), 0, "footer contains actions only")
    const body = dialog.locator("[data-booking-details-body]")
    const bodyBox = await body.boundingBox(), footerBox = await dialog.locator("footer").count() ? await dialog.locator("footer").boundingBox() : null
    const headerBox = await dialog.locator("header").boundingBox()
    assert.ok(bodyBox.y >= headerBox.y + headerBox.height - 1, "the header sits outside the scrolling body")
    assert.ok(bodyBox.y + bodyBox.height <= (footerBox?.y ?? box.y + box.height) + 1, "content ends above any footer")
    assert.equal(await body.evaluate(el => getComputedStyle(el).minHeight), "0px")
    assert.equal(await body.evaluate(el => getComputedStyle(el).overflowY), "auto")
    assert.ok((await body.boundingBox()).height > 80, "body must retain a usable scroll area")
    const scrollRegions = await dialog.evaluate(el => [el, ...el.querySelectorAll("*")].filter(node => ["auto", "scroll"].includes(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1).length)
    assert.equal(scrollRegions, 1, "one scroll region")
    for (const value of await dialog.locator("dd").all()) {
      assert.equal(await value.evaluate(el => getComputedStyle(el).color), "rgb(0, 0, 0)")
      assert.equal(await value.evaluate(el => Number(getComputedStyle(el).fontWeight) >= 700), true)
      assert.equal(await value.evaluate(el => el.scrollWidth > el.clientWidth + 1), false)
    }
    for (const action of await dialog.locator("footer button").all()) {
      const actionBox = await action.boundingBox()
      assert.equal(actionBox.height, 44)
      assert.ok(actionBox.y >= box.y && actionBox.y + actionBox.height <= viewport.height, "all footer actions remain reachable")
    }
    await body.evaluate(el => { el.scrollTop = el.scrollHeight })
    assert.equal(await body.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 2), true)
    const last = await body.locator("button").last().boundingBox()
    assert.ok(last.y + last.height <= bodyBox.y + bodyBox.height + 1, "the final document action is reachable above the footer")
    assert.deepEqual(await dialog.locator("header").boundingBox(), headerBox)
    if (footerBox) assert.deepEqual(await dialog.locator("footer").boundingBox(), footerBox)
  }
  const adminModal = () => page.getByRole("dialog").filter({ has: page.getByRole("region", { name: "Booking details content", exact: true }) })
  const adminGeometry = async () => {
    const dialog = adminModal(), body = dialog.getByRole("region", { name: "Booking details content", exact: true })
    const box = await dialog.boundingBox(), bodyBox = await body.boundingBox(), header = await dialog.locator("header").boundingBox()
    const footer = await dialog.locator("footer").count() ? await dialog.locator("footer").boundingBox() : null
    assert.ok(box.y >= 0 && box.x >= 0 && box.x + box.width <= page.viewportSize().width + 1 && box.y + box.height <= page.viewportSize().height + 1, "admin dialog fits the viewport")
    assert.ok(bodyBox.y >= header.y + header.height - 1 && bodyBox.y + bodyBox.height <= (footer?.y ?? box.y + box.height) + 1)
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false)
    assert.equal(await dialog.getByRole("button", { name: "Close booking details", exact: true }).count(), 1)
    assert.equal(await body.evaluate(el => getComputedStyle(el).overflowY), "auto")
    const scrollers = await dialog.evaluate(el => [el, ...el.querySelectorAll("*")].filter(node => ["auto", "scroll"].includes(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1).length)
    assert.equal(scrollers, await body.evaluate(el => Number(el.scrollHeight > el.clientHeight + 1)), "only the details body may scroll when content overflows")
    await body.evaluate(el => { el.scrollTop = el.scrollHeight })
    assert.equal(await body.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 2), true)
    assert.deepEqual(await dialog.locator("header").boundingBox(), header)
    if (footer) assert.deepEqual(await dialog.locator("footer").boundingBox(), footer)
  }
  for (const [width, height] of [[1366, 768], [1280, 720], [768, 1024], [640, 960], [390, 844], [320, 568]]) {
    await page.setViewportSize({ width, height })
    for (const category of ["office", "event"]) {
      let receiptStyle
      for (const state of ["pending", "approved", "active"]) {
        current = `${width}x${height} ${category} ${state}`
        await page.goto(`${origin}/__details?bookingId=LOCAL-BOOKING&category=${category}&state=${state}`)
        await page.mouse.move(0, 0)
        await modal().waitFor()
        await geometry()
        await footerArrangement(state === "active" ? ["Modify Booking", "Cancel Booking"]
          : state === "approved" ? ["Request Refund"] : [])
        await documentsArrangement()
        const receipt = modal().getByRole("button", { name: "View Receipt", exact: true })
        const style = await receipt.evaluate(el => { const s = getComputedStyle(el);return [el.getBoundingClientRect().width, s.height, s.borderRadius, s.fontSize, s.paddingLeft, s.backgroundColor] })
        if (receiptStyle) assert.deepEqual(style, receiptStyle, "View Receipt must retain consistent sizing/style across states")
        receiptStyle = style
        if (category === "office") {
          assert.equal(await modal().getByText("Time", { exact: true }).count(), 0)
          await field("Rental Start Date").waitFor(); await field("Rental End Date").waitFor()
          for (const [term, label] of [["6_months", "6 Months"], ["1_year", "1 Year"], ["2_years", "2 Years"]]) {
            await page.evaluate(term => window.fixture.patchBooking({ officeRentalTerm: term }), term)
            await field("Rental Term").getByText(label, { exact: true }).waitFor()
          }
        } else assert.match(await field("Time").textContent(), /08:00.*14:00/)
        if (state === "pending") {
          await modal().getByRole("status").getByText(/awaiting admin review/).waitFor()
          assert.equal(await modal().getByRole("button", { name: "Modify Booking", exact: true }).count(), 0)
          assert.equal(await modal().getByRole("button", { name: "Request Refund", exact: true }).count(), 0)
        }
        if (state === "approved") {
          assert.equal(await modal().getByText("May be eligible for refund", { exact: true }).count(), 0)
          await field("Cancellation Requested At").waitFor(); await field("Cancellation Reviewed At").waitFor(); await field("Cancelled At").waitFor()
          await field("Cancellation Approved At").waitFor()
          await captureScreenshot({ path: join(output, `${width}-${category}-eligible.png`) })
          await modal().getByRole("button", { name: "Request Refund", exact: true }).click()
          await field("Refund Status").getByText("Requested — awaiting processing", { exact: true }).waitFor()
          assert.deepEqual(await page.evaluate(() => window.fixture.refunds), ["LOCAL-BOOKING"])
          assert.equal(await modal().getByRole("button", { name: "Request Refund", exact: true }).count(), 0)
          await geometry()
          await footerArrangement([])
          await captureScreenshot({ path: join(output, `${width}-${category}-refund-requested.png`) })
          await page.evaluate(() => window.fixture.patchBooking({ refundStatus: "refunded", refundedAt: "2026-10-30T04:00:00Z", refundProcessedBy: "Local Reviewer" }))
          await field("Refund Completed At").waitFor()
          await geometry(); await footerArrangement([]); await documentsArrangement()
        }
        if (state === "active") assert.equal(await modal().getByRole("button", { name: "Modify Booking", exact: true }).isEnabled(), true)
        await captureScreenshot({ path: join(output, `${width}-${category}-${state}-bottom.png`) })
        await modal().locator("[data-booking-details-body]").evaluate(el => { el.scrollTop = 0 })
        await captureScreenshot({ path: join(output, `${width}-${category}-${state}-top.png`) })
        if (state === "active") {
          // Check natural tab order through Documents and management actions.
          await modal().getByRole("button", { name: "View Contract", exact: true }).focus()
          for (const name of ["Download Contract", "View Receipt", "Modify Booking", "Cancel Booking"]) {
            await page.keyboard.press("Tab")
            assert.equal(await page.evaluate(() => document.activeElement?.textContent.trim()), name)
            assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow), "none", "keyboard focus stays visible")
          }
          const original = await page.evaluate(() => window.fixture.snapshot())
          await page.evaluate(() => window.fixture.patchBooking({ receipt: null, paymentStatus: "partial", amountPaid: 5000 }))
          await footerArrangement(["Modify Booking", "Pay Now", "Cancel Booking"])
          await geometry(); await documentsArrangement()
          await captureScreenshot({ path: join(output, `${width}-${category}-three-actions.png`) })
          await page.evaluate(() => window.fixture.patchBooking({ paymentStatus: "unpaid", amountPaid: 0, isSlotSecured: false }))
          await footerArrangement(["Modify Booking", "Pay Now"])
          await page.evaluate(original => window.fixture.patchBooking({ ...original, isSlotSecured: false }), original)
          await footerArrangement(["Modify Booking"]); await documentsArrangement()
          await page.evaluate(original => window.fixture.patchBooking(original), original)
          // Existing enabled/disabled conditions must survive the regrouping.
          await page.evaluate(() => window.fixture.patchBooking({ status: "modification_under_review", bookingStatus: "Modification Under Review" }))
          await page.waitForFunction(() => [...document.querySelectorAll('[data-booking-details-body] ~ footer button')].some(el => el.textContent.trim() === 'Modify Booking' && el.disabled))
          await footerArrangement(["Modify Booking", "Cancel Booking"])
          await page.evaluate(() => window.fixture.patchBooking({ status: "confirmed", bookingStatus: "Confirmed" }))
          // Use the real cancellation dialog, then follow subscription-driven
          // approval and the real Request Refund button without reloading.
          await modal().getByRole("button", { name: "Cancel Booking", exact: true }).click()
          const cancellation = page.getByRole("dialog", { name: "Request Cancellation", exact: true })
          await cancellation.getByPlaceholder("Type your reason here...").fill("Local footer transition check")
          await cancellation.getByRole("button", { name: "Submit Cancellation Request", exact: true }).click()
          await modal().getByRole("status").getByText(/awaiting admin review/).waitFor()
          assert.deepEqual(await page.evaluate(() => window.fixture.cancellations), [{ id: "LOCAL-BOOKING", reason: "Local footer transition check" }])
          await geometry(); await footerArrangement([]); await documentsArrangement()
          await captureScreenshot({ path: join(output, `${width}-${category}-after-cancellation-request.png`) })
          await page.evaluate(() => window.fixture.approveCancellation())
          await modal().getByRole("button", { name: "Request Refund", exact: true }).waitFor()
          await geometry(); await footerArrangement(["Request Refund"]); await documentsArrangement()
          await captureScreenshot({ path: join(output, `${width}-${category}-after-cancellation-approval.png`) })
          await modal().getByRole("button", { name: "Request Refund", exact: true }).click()
          await field("Refund Status").getByText("Requested — awaiting processing", { exact: true }).waitFor()
          await geometry(); await footerArrangement([]); await documentsArrangement()
          await captureScreenshot({ path: join(output, `${width}-${category}-after-refund-request.png`) })
        }
        await modal().getByRole("button", { name: "Close", exact: true }).click()
        await page.waitForFunction(() => !document.body.hasAttribute("data-scroll-locked"))
        passed.push(current); console.log(`PASS ${current}`)
      }
      current = `${width}x${height} admin ${category} eligible/requested/refunded`
      await page.goto(`${origin}/__details?surface=admin&category=${category}&state=approved`)
      await page.getByRole("button", { name: "View Details", exact: true }).click()
      await adminModal().waitFor()
      await adminGeometry(); await footerArrangement([], adminModal())
      await adminModal().getByText("Awaiting refund request from customer", { exact: true }).waitFor()
      await captureScreenshot({ path: join(output, `${width}-admin-${category}-eligible.png`) })
      await page.evaluate(() => window.fixture.patchBooking({ refundStatus: "requested" }))
      await adminModal().getByRole("button", { name: "Mark as Refunded", exact: true }).waitFor()
      await adminGeometry(); await footerArrangement(["Mark as Refunded"], adminModal())
      assert.equal(await adminModal().getByRole("button", { name: "Mark as Refunded", exact: true }).count(), 1)
      await captureScreenshot({ path: join(output, `${width}-admin-${category}-requested.png`) })
      await adminModal().getByRole("button", { name: "Mark as Refunded", exact: true }).click()
      await adminModal().getByText("Refund Completed", { exact: true }).waitFor()
      assert.deepEqual(await page.evaluate(() => window.fixture.completedRefunds), ["LOCAL-BOOKING"])
      await adminGeometry(); await footerArrangement([], adminModal())
      await captureScreenshot({ path: join(output, `${width}-admin-${category}-refunded.png`) })
      await adminModal().getByRole("button", { name: "Close booking details", exact: true }).click()
      await page.waitForFunction(() => !document.body.hasAttribute("data-scroll-locked"))
      passed.push(current); console.log(`PASS ${current}`)
      if (category === "event") {
        current = `${width}x${height} admin three/two/one visible actions`
        await page.goto(`${origin}/__details?surface=admin&category=event&state=active`)
        await page.getByRole("button", { name: "View Details", exact: true }).click()
        await page.evaluate(() => window.fixture.patchBooking({ amountPaid: 5000, paymentStatus: "partial", contractSigned: false, contractStatus: "Pending" }))
        await footerArrangement(["Send Balance Reminder", "Record Onsite Payment", "Mark Contract as Signed"], adminModal())
        await adminGeometry()
        await captureScreenshot({ path: join(output, `${width}-admin-three-actions.png`) })
        await page.evaluate(() => window.fixture.patchBooking({ contractSigned: true, contractStatus: "Signed" }))
        await footerArrangement(["Send Balance Reminder", "Record Onsite Payment"], adminModal())
        await page.evaluate(() => window.fixture.patchBooking({ status: "pending", bookingStatus: "Pending", amountPaid: 0, paymentStatus: "unpaid" }))
        await footerArrangement(["Record Onsite Payment"], adminModal())
        await adminModal().getByRole("button", { name: "Close booking details", exact: true }).click()
        await page.waitForFunction(() => !document.body.hasAttribute("data-scroll-locked"))
        passed.push(current); console.log(`PASS ${current}`)
      }
    }
  }
  // Verify document availability and the moved document/modify/payment callbacks.
  for (const category of ["office", "event"]) {
    current = `customer ${category} document/modify/payment handlers`
    await page.goto(`${origin}/__details?bookingId=LOCAL-BOOKING&category=${category}&state=active`)
    await modal().getByRole("button", { name: "View Contract", exact: true }).click()
    const preview = page.getByRole("dialog", { name: "Local Contract.png", exact: true })
    await preview.getByRole("img", { name: "Contract", exact: true }).waitFor()
    await preview.getByRole("button", { name: "Close", exact: true }).click()
    await modal().waitFor()
    const [download] = await Promise.all([
      page.waitForEvent("download"), modal().getByRole("button", { name: "Download Contract", exact: true }).click(),
    ])
    assert.equal(download.suggestedFilename(), "Local Contract.png")
    await modal().getByRole("button", { name: "Modify Booking", exact: true }).click()
    const modification = page.getByRole("dialog", { name: "Modify Booking", exact: true })
    await modification.waitFor()
    await modification.getByRole("button", { name: "Close", exact: true }).click()
    await page.getByRole("button", { name: "View Details", exact: true }).click()
    await page.evaluate(() => window.fixture.patchBooking({ status: "pending", paymentStatus: "unpaid", amountPaid: 0, receipt: null, isSlotSecured: false }))
    await modal().getByRole("button", { name: "Pay Now", exact: true }).waitFor()
    assert.equal(await modal().locator('[data-booking-document="receipt"]').count(), 0)
    await modal().getByRole("button", { name: "Pay Now", exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.fixture.navigation), ["/portal/payments?bookingId=LOCAL-BOOKING"])

    await page.goto(`${origin}/__details?bookingId=LOCAL-BOOKING&category=${category}&state=active&noContract=1`)
    assert.equal(await modal().locator('[data-booking-document="contract"]').count(), 0)
    await modal().getByText("No contract document uploaded yet.", { exact: true }).waitFor()
    await documentsArrangement()
    await page.evaluate(() => window.fixture.patchBooking({ receipt: null, paymentStatus: "unpaid", amountPaid: 0, status: "contract_signing_required", contractStatus: "Pending", contractSigned: false }))
    await modal().getByText("Contract signing must be completed onsite at the One Estela Place office.", { exact: true }).waitFor()
    assert.equal(await modal().getByRole("heading", { name: "Documents", exact: true }).count(), 0, "no empty Documents section")
    await modal().getByRole("button", { name: "Close", exact: true }).click()
    passed.push(current); console.log(`PASS ${current}`)
  }
  // All retained admin actions still open their original workflow dialogs.
  await page.setViewportSize({ width: 1366, height: 768 })
  for (const category of ["office", "event"]) {
    current = `admin ${category} retained management actions`
    await page.goto(`${origin}/__details?surface=admin&category=${category}&state=active`)
    await page.getByRole("button", { name: "View Details", exact: true }).click()
    const openWorkflow = async (action, title) => {
      await adminModal().getByRole("button", { name: action, exact: true }).click()
      const workflow = page.getByRole("dialog", { name: title, exact: true })
      await workflow.waitFor()
      await workflow.getByRole("button", { name: "Cancel", exact: true }).click()
    }
    // Fully paid future bookings keep completion disabled, then enable it once ended.
    assert.equal(await adminModal().getByRole("button", { name: "Mark as Completed", exact: true }).isDisabled(), true)
    await page.evaluate(() => window.fixture.patchBooking({ date: "2020-03-01", endDate: "2020-09-01" }))
    await openWorkflow("Mark as Completed", "Mark Booking as Completed?")
    await page.evaluate(category => window.fixture.patchBooking({ contractSigned: false, contractStatus: "Pending", status: category === "office" ? "contract_signing_required" : "confirmed" }), category)
    await footerArrangement(category === "office" ? ["Mark Contract as Signed"] : ["Mark Contract as Signed", "Mark as Completed"], adminModal())
    await openWorkflow("Mark Contract as Signed", "Mark Contract as Signed?")

    await page.evaluate(() => window.fixture.patchBooking({ status: "confirmed", amountPaid: 5000, paymentStatus: "partial", date: "2099-03-01", endDate: "2099-09-01", contractSigned: true, contractStatus: "Signed" }))
    await footerArrangement(["Send Balance Reminder", "Record Onsite Payment"], adminModal())
    await openWorkflow("Send Balance Reminder", "Send Balance Reminder?")
    await adminModal().getByRole("button", { name: "Record Onsite Payment", exact: true }).click()
    const onsite = page.getByRole("dialog", { name: "Record Onsite Payment", exact: true })
    await onsite.waitFor()
    await onsite.getByRole("button", { name: /close/i }).click()

    await page.evaluate(() => window.fixture.patchBooking({ status: "cancellation_requested", cancellationStatus: "Pending", cancellationRequested: true }))
    await footerArrangement(["Reject Cancellation", "Approve Cancellation"], adminModal())
    await openWorkflow("Reject Cancellation", "Continue Booking?")
    await openWorkflow("Approve Cancellation", "Approve Cancellation?")
    await page.evaluate(() => window.fixture.patchBooking({ status: "modification_under_review", cancellationStatus: "None", cancellationRequested: false, modificationRequested: true, modificationStatus: "Under Review" }))
    await footerArrangement(["Decline Modification", "Approve Modification"], adminModal())
    await openWorkflow("Decline Modification", "Decline Modification?")
    await openWorkflow("Approve Modification", "Approve Modification?")
    await adminModal().getByRole("button", { name: "Close booking details", exact: true }).click()
    await page.waitForFunction(() => !document.body.hasAttribute("data-scroll-locked"))
    passed.push(current); console.log(`PASS ${current}`)
  }
  // Exercise the real receipt action's dialog hand-off, including lock cleanup.
  await page.goto(`${origin}/__details?bookingId=LOCAL-BOOKING&category=office&state=approved`)
  await modal().getByRole("button", { name: "View Receipt", exact: true }).click()
  await page.getByRole("dialog").filter({ hasText: "LOCAL-RECEIPT" }).waitFor()
  await page.keyboard.press("Escape")
  // Existing receipt behavior returns to Booking Details; the lock must remain
  // until that parent view is closed as well.
  await modal().waitFor()
  assert.equal(await page.locator("body").evaluate(el => el.hasAttribute("data-scroll-locked")), true)
  await modal().getByRole("button", { name: "Close", exact: true }).click()
  await page.waitForFunction(() => !document.body.hasAttribute("data-scroll-locked"))
  assert.deepEqual(errors, [])
  console.log(`Booking Details: ${passed.length} responsive scenarios passed, including customer/admin cancellation/refund transitions, document grouping/availability, keyboard order, action handlers, and receipt hand-off. Artifacts: ${output}`)
} catch (error) {
  failure = { current, message: error.message }
  await captureScreenshot({ path: join(output, "failure.png") }).catch(() => {})
  throw error
} finally {
  await writeFile(join(output, "results.json"), JSON.stringify({ passed, failure, errors, warnings: [...new Set(warnings)],
    scope: "Real customer/admin booking pages and Radix dialogs; local provider/service fixtures, Arial font fallback, no live persistence." }, null, 2))
  console.log(`Booking Details artifacts: ${output}`)
  await browser?.close(); await server.close()
}
