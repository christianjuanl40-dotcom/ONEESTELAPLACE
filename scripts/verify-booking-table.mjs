/**
 * Local-only Chromium checks for the actual Admin Booking Management page.
 * The booking hook and service boundaries are deterministic in-memory fixtures;
 * no Firebase, API, or production data is accessed.
 */
import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"
import tailwindcss from "tailwindcss"
import { chromium } from "playwright"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const output = await mkdtemp(join(process.env.BOOKING_TABLE_TEMP_DIR || tmpdir(), "one-estela-booking-table-"))

const modules = {
  state: `
    import {useSyncExternalStore} from 'react';
    const fixtureBooking=(id,createdAt,date,eventName,status='pending')=>({
      id,userId:'client-'+id,venue:'Grand Hall',eventName,eventType:'Celebration',guestCount:20,date,
      startTime:'08:00',endTime:'14:00',status,paymentStatus:'unpaid',createdAt,totalPrice:1000,
      amountPaid:0,userInfo:{name:'Customer '+id,email:id.toLowerCase()+'@fixture.test',phone:'09170000000'}
    });
    let snapshot={bookings:[
      fixtureBooking('BOOK-NEWEST-CREATED','2030-05-10T00:00:00.000Z','2030-01-01','Newest Created'),
      fixtureBooking('BOOK-OLDEST-CREATED','2030-01-10T00:00:00.000Z','2030-12-31','Oldest Created','confirmed'),
      fixtureBooking('BOOK-TIE-B','2030-03-01T00:00:00.000Z','2030-03-02','Tie B'),
      fixtureBooking('BOOK-TIE-A','2030-03-01T00:00:00.000Z','2030-03-03','Tie A'),
      fixtureBooking('BOOK-MISSING',undefined,'2030-06-01','Missing Created','confirmed'),
      ...Array.from({length:8},(_,index)=>fixtureBooking(
        'BOOK-FILLER-'+index,'2030-02-'+String(index+1).padStart(2,'0'),
        '2030-04-'+String(index+1).padStart(2,'0'),'Filler '+index,'confirmed')),
    ],payments:[],maintenanceRecords:[],officeRentals:[]};
    const listeners=new Set();
    export const getState=()=>snapshot;
    export const subscribe=listener=>{listeners.add(listener);return()=>listeners.delete(listener)};
    export const updateBookings=bookings=>{snapshot={...snapshot,bookings};listeners.forEach(listener=>listener())};
    window.fixture={
      get bookings(){return snapshot.bookings},
      updateBookings,
      addRealtimeBooking(){updateBookings([...snapshot.bookings,fixtureBooking('BOOK-REALTIME-NEW','2030-06-01T00:00:00.000Z','2029-01-01','Realtime New')])},
    };
  `,
  booking: `
    import {useSyncExternalStore} from 'react';
    import {getState,subscribe} from 'virtual:booking-table-state';
    const actions={
      retryData:()=>{},markContractSigned:async()=>{},approveCancellation:async()=>{},declineCancellation:async()=>{},
      updateBookingStatus:async()=>null,markAsRefunded:async()=>{},sendBalanceReminder:async()=>{},
      addMaintenanceRecords:async()=>{},removeMaintenanceRecord:async()=>{},removeMaintenanceRecords:async()=>{},
    };
    export function useBookingData(){const state=useSyncExternalStore(subscribe,getState,getState);return {...state,...actions,isLoading:false,dataErrors:{},maintenanceError:null,isMaintenanceLoading:false,paymentRecords:[]}}
    export function useBookings(){const state=useSyncExternalStore(subscribe,getState,getState);return {...state,...actions,paymentRecords:[]}}
  `,
  auth: `export const useAuth=()=>({user:{id:'LOCAL-ADMIN',role:'admin',permissions:{bookings:true}},isLoading:false,initializationError:null})`,
  toast: `export const useToast=()=>({toast:value=>window.fixture.lastToast=value})`,
  notifications: `export const useNotifications=()=>({markByBookingId:()=>{}})`,
  cms: `export const useCMS=()=>({cmsData:{venues:[{id:'venue.A',name:'Grand Hall'}],offices:[]},getOfficeRooms:()=>[]})`,
  navigation: `const router={replace:()=>{},push:()=>{}};export const useRouter=()=>router;export const useSearchParams=()=>new URLSearchParams()`,
  token: `export const getAuthScope=async()=> 'LOCAL-ADMIN';export const getAuthHeaders=async()=>({'Content-Type':'application/json','X-Local-Fixture':'booking-table'})`,
  firebase: `export const auth={currentUser:null};export const db={}`,
  entry: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import AdminBookings from '@/app/(admin)/dashboard/bookings/page';
    import '@/app/globals.css';import 'virtual:booking-table-state';
    createRoot(document.getElementById('root')).render(React.createElement(AdminBookings));
  `,
}

const mocks = [
  [/^virtual:booking-table-state$/, "state"],
  [/\/client\/contexts\/booking-context(?:\.tsx?)?$/, "booking"],
  [/\/auth\/auth-context(?:\.tsx?)?$/, "auth"],
  [/\/hooks\/use-toast(?:\.tsx?)?$/, "toast"],
  [/\/contexts\/notification-context(?:\.tsx?)?$/, "notifications"],
  [/\/admin\/contexts\/cms-context(?:\.tsx?)?$/, "cms"],
  [/^next\/navigation$/, "navigation"],
  [/\/lib\/auth-token(?:\.ts)?$/, "token"],
  [/\/lib\/firebase(?:\.ts)?$/, "firebase"],
]

const server = await createServer({
  configFile: false,
  envFile: false,
  envDir: false,
  root,
  cacheDir: join(output, "vite-cache"),
  logLevel: "error",
  define: { "process.env.NEXT_PUBLIC_PERF_TRACE": JSON.stringify("0") },
  server: { host: "127.0.0.1", port: 0, forwardConsole: false },
  resolve: { alias: { "@": root, "@shared": join(root, "src/modules/shared") } },
  oxc: { jsx: { runtime: "automatic" } },
  css: { postcss: { plugins: [tailwindcss({ config: join(root, "tailwind.config.ts") })] } },
  optimizeDeps: {
    noDiscovery: true,
    include: [
      "react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react",
      "clsx", "tailwind-merge", "class-variance-authority", "@radix-ui/react-dialog",
      "@radix-ui/react-visually-hidden", "@radix-ui/react-select", "@radix-ui/react-slot",
      "@radix-ui/react-label", "@radix-ui/react-tooltip", "@radix-ui/react-tabs",
    ],
  },
  plugins: [{
    name: "local-booking-table-fixtures",
    enforce: "pre",
    resolveId(source) {
      if (source.startsWith("virtual:booking-table-")) return `\0booking-table-${source.slice("virtual:booking-table-".length)}.tsx`
      const match = mocks.find(([pattern]) => pattern.test(source.replaceAll("\\", "/")))
      return match ? `\0booking-table-${match[1]}.tsx` : undefined
    },
    load(id) {
      return modules[id.match(/^\0booking-table-(.+)\.tsx$/)?.[1]]
    },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/__booking-table")) return next()
        response.setHeader("Content-Type", "text/html")
        response.end(await vite.transformIndexHtml(request.url, '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__booking-table-entry.tsx"></script></body></html>'))
      })
    },
  }],
})

let browser
const passed = []
const errors = []
const blocked = []
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true, channel: process.env.BOOKING_TABLE_BROWSER_CHANNEL || undefined })
  const context = await browser.newContext({ locale: "en-US", timezoneId: "Asia/Manila", serviceWorkers: "block" })
  await context.route("**/*", (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === origin || ["data:", "blob:"].includes(url.protocol)) return route.continue()
    blocked.push(`${request.method()} ${url.origin}${url.pathname}`)
    return route.abort()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })

  const check = async (name, run) => {
    await run()
    passed.push(name)
    console.log(`PASS ${name}`)
  }
  const table = () => page.locator('[data-slot="table-container"]')
  const desktopIds = () => table().locator('[data-slot="table-body"] tr').evaluateAll((rows) => rows.map((row) => row.querySelector(".oe-table-label")?.textContent?.trim() || ""))
  const mobileIds = () => page.locator(".space-y-2.md\\:hidden > div").evaluateAll((rows) => rows.map((row) => row.querySelector("p")?.textContent?.trim() || ""))
  const waitForPaint = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const pageScrollMetrics = () => page.evaluate(() => ({ innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, scrollY: window.scrollY }))

  await page.goto(`${origin}/__booking-table`)
  const bookingHeading = page.getByRole("heading", { name: "Booking Management", exact: true })
  await bookingHeading.waitFor()
  assert.match(await bookingHeading.getAttribute("class") || "", /\bsr-only\b/)
  assert.equal(await page.locator('header[aria-label="Booking management toolbar"]').count(), 1)

  await check("default newest-created ordering and post-sort pagination", async () => {
    await page.setViewportSize({ width: 768, height: 720 })
    const firstPage = await desktopIds()
    assert.equal(firstPage[0], "BOOK-NEWEST-CREATED")
    assert.equal(firstPage.length, 10)
    await page.getByRole("button", { name: "Next", exact: true }).click()
    const secondPage = await desktopIds()
    const allIds = [...firstPage, ...secondPage]
    assert.equal(allIds.at(-1), "BOOK-MISSING")
    assert.ok(allIds.indexOf("BOOK-OLDEST-CREATED") < allIds.indexOf("BOOK-MISSING"))
    await page.getByRole("button", { name: "Previous", exact: true }).click()
  })

  await check("equal timestamps and missing timestamps are deterministic", async () => {
    await page.getByLabel("Search bookings", { exact: true }).fill("Tie")
    await waitForPaint()
    assert.deepEqual(await desktopIds(), ["BOOK-TIE-A", "BOOK-TIE-B"])
    await page.getByRole("button", { name: "Clear", exact: true }).click()
    await page.getByRole("combobox", { name: "Booking status filter", exact: true }).click()
    await page.getByRole("option", { name: "Confirmed", exact: true }).click()
    await waitForPaint()
    const confirmed = await desktopIds()
    assert.equal(confirmed[0], "BOOK-FILLER-7")
    assert.equal(confirmed.at(-1), "BOOK-MISSING")
    await page.getByRole("combobox", { name: "Booking status filter", exact: true }).click()
    await page.getByRole("option", { name: "All", exact: true }).click()
    await waitForPaint()
  })

  await check("manual schedule sorting and explicit newest-first reset", async () => {
    const scheduleSort = () => page.getByRole("button", { name: /Sort bookings by Schedule/ })
    await scheduleSort().click()
    await waitForPaint()
    assert.equal((await desktopIds())[0], "BOOK-OLDEST-CREATED")
    await scheduleSort().click()
    await waitForPaint()
    assert.equal((await desktopIds())[0], "BOOK-NEWEST-CREATED")
    await page.getByRole("button", { name: "Reset booking sorting to newest first", exact: true }).click()
    await waitForPaint()
    assert.equal((await desktopIds())[0], "BOOK-NEWEST-CREATED")
  })

  await check("new realtime bookings move into the creation-order position", async () => {
    await page.evaluate(() => window.fixture.addRealtimeBooking())
    await table().getByText("BOOK-REALTIME-NEW", { exact: true }).waitFor()
    assert.equal((await desktopIds())[0], "BOOK-REALTIME-NEW")
  })

  await check("vertical page scrolling works over table headers and cells", async () => {
    await page.evaluate(() => window.scrollTo(0, 0))
    const header = table().locator('[data-slot="table-head"]').first()
    const headerBox = await header.boundingBox()
    assert.ok(headerBox)
    await page.mouse.move(headerBox.x + 20, headerBox.y + 15)
    await page.mouse.wheel(0, 500)
    await page.waitForTimeout(100)
    assert.ok((await page.evaluate(() => window.scrollY)) > 0)

    await page.evaluate(() => window.scrollTo(0, 0))
    const cell = table().locator('[data-slot="table-body"] tr').first().locator('[data-slot="table-cell"]').nth(1)
    const cellBox = await cell.boundingBox()
    assert.ok(cellBox)
    await page.mouse.move(cellBox.x + 20, cellBox.y + 15)
    await page.mouse.wheel(0, 500)
    await page.waitForTimeout(100)
    assert.ok((await page.evaluate(() => window.scrollY)) > 0)
  })

  await check("horizontal table scrolling remains contained", async () => {
    await page.setViewportSize({ width: 768, height: 720 })
    await page.evaluate(() => window.scrollTo(0, 0))
    const dimensions = await table().evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }))
    assert.ok(dimensions.scrollWidth > dimensions.clientWidth)
    const box = await table().boundingBox()
    assert.ok(box)
    await page.mouse.move(box.x + box.width / 2, box.y + 40)
    await page.mouse.wheel(500, 0)
    await page.waitForTimeout(100)
    assert.ok((await table().evaluate((element) => element.scrollLeft)) > 0)
    const metrics = await pageScrollMetrics()
    assert.ok(metrics.scrollWidth <= metrics.innerWidth + 1)
  })

  await check("desktop, tablet, and mobile layouts retain usable overflow", async () => {
    for (const width of [1440, 1024, 768, 375, 320]) {
      await page.setViewportSize({ width, height: 720 })
      await waitForPaint()
      const metrics = await pageScrollMetrics()
      assert.ok(metrics.scrollWidth <= metrics.innerWidth + 1, `${width}px page has horizontal overflow`)
      if (width >= 768) assert.ok(await table().count() === 1)
      else assert.ok((await mobileIds()).length > 0)
    }
    await page.setViewportSize({ width: 375, height: 720 })
    await page.evaluate(() => window.scrollTo(0, 0))
    const mobileRow = page.locator(".space-y-2.md\\:hidden").getByText("BOOK-REALTIME-NEW", { exact: true })
    const mobileBox = await mobileRow.boundingBox()
    assert.ok(mobileBox)
    await page.mouse.move(mobileBox.x + 10, mobileBox.y + 10)
    await page.mouse.wheel(0, 400)
    await page.waitForTimeout(100)
    assert.ok((await page.evaluate(() => window.scrollY)) > 0)
  })

  await check("single primary badge follows lifecycle and schedule without changing filter semantics", async () => {
    await page.evaluate(() => {
      const base = window.fixture.bookings[0]
      window.fixture.updateBookings([
        { ...base, id: 'STATUS-PENDING', status: 'pending', date: '2099-01-01' },
        { ...base, id: 'STATUS-UPCOMING', status: 'confirmed', date: '2099-01-01' },
        { ...base, id: 'STATUS-ACTIVE', status: 'confirmed', date: '2000-01-01', endDate: '2099-01-01' },
        { ...base, id: 'STATUS-COMPLETED', status: 'completed' },
        { ...base, id: 'STATUS-CANCELLED', status: 'cancelled' },
        { ...base, id: 'STATUS-REJECTED', status: 'declined' },
        { ...base, id: 'STATUS-LEGACY', status: 'confirmed', date: '' },
      ])
    })
    const expected = ['Pending', 'Upcoming', 'Active', 'Completed', 'Cancelled', 'Rejected', 'Confirmed']
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 720 })
      await waitForPaint()
      const rows = width >= 768 ? table().locator('tbody tr') : page.locator('.space-y-2.md\\:hidden > div')
      assert.equal(await rows.count(), 7)
      const labels = []
      for (const row of await rows.all()) {
        assert.equal(await row.locator('.oe-status-badge').count(), 1, 'exactly one badge per row')
        labels.push((await row.locator('[data-booking-table-status]').innerText()).trim())
      }
      assert.deepEqual(labels.sort(), [...expected].sort())
    }
    await page.getByRole('combobox', { name: 'Booking status filter', exact: true }).click()
    await page.getByRole('option', { name: 'Confirmed', exact: true }).click()
    await waitForPaint()
    assert.equal(await table().locator('tbody tr').count(), 3, 'Confirmed filter still uses lifecycle, not the new label')
    await page.getByRole('button', { name: 'View Details', exact: true }).first().click()
    await page.getByRole('dialog').getByText('Confirmed', { exact: true }).first().waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('heading', { name: 'Booking Management', exact: true }).count(), 1)
    assert.match(await page.getByRole('heading', { name: 'Booking Management', exact: true }).getAttribute('class') || '', /\bsr-only\b/)
    assert.equal(await page.locator('.oe-page-kicker, .oe-page-description').count(), 0)
  })

  assert.equal(blocked.length, 0, `browser attempted external requests: ${blocked.join(", ")}`)
  assert.equal(errors.length, 0, `browser errors: ${errors.join("\n")}`)
  console.log(`Booking table/order browser checks passed (${passed.length} scenarios). Artifacts: ${output}`)
} finally {
  await browser?.close()
  await server.close()
}
