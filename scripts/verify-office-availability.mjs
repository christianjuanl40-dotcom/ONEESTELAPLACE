/** Actual ReserveDialog, availability hook/client, shared calculations and Radix
 * layout in Chromium. Service data is synthetic and never leaves local memory.
 * Route persistence/concurrency are covered by the API/emulator test suites. */
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"
import tailwindcss from "tailwindcss"
import { chromium } from "playwright"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const output = await mkdtemp(join(process.env.OFFICE_AVAILABILITY_TEMP_DIR || tmpdir(), "office-availability-"))
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY4sAAAAASUVORK5CYII="
const modules = {
  state: `
    import {useSyncExternalStore} from 'react';
    import {calculateAvailabilityRange,findEarliestOfficeStartDate,getMinimumBookingDate,getOfficeRentalEndDate,getOfficeRoomStatus} from '@/src/modules/shared/lib/availability';
    import {getCatalogAvailabilitySpace} from '@/src/modules/shared/lib/resource-identity';
    import {canAutomaticallyExpireBooking,automaticBookingExpiryFields} from '@/src/modules/shared/lib/booking-lifecycle';
    const listeners=new Set();
    const occupied={id:'LOCAL-OCCUPIED',bookingCategory:'office',isOfficeRental:true,venueId:'building.A',officeId:'building.A',spaceId:'room.1',
      status:'active_rental',date:'2026-10-01',endDate:'2027-05-26',officeRentalTerm:'6_months',isSlotSecured:true};
    let state={bookings:[occupied],maintenanceRecords:[],officeRentals:[]};
    let remote=state,failNext=false,badNext=false,deferNext=false;
    const pending=[];
    const publish=patch=>{state={...state,...patch};remote=state;listeners.forEach(fn=>fn())};
    const catalog={venues:[],offices:[
      {id:'building.A',name:'Ground Floor Office',price:10000,description:'Local office fixture',image:${JSON.stringify(image)},rooms:Array.from({length:8},(_,i)=>({id:'room.'+(i+1),name:'Room '+(i+1)}))},
      {id:'building.B',name:'Other Building',price:10000,description:'Other building',image:${JSON.stringify(image)},rooms:[{id:'room.1',name:'Room 1'}]},
    ]};
    const cms={cmsData:catalog};
    export const useCMS=()=>cms;
    const addBooking=async payload=>{window.fixture.submissions.push(payload);publish({bookings:[...state.bookings,{...payload,id:'LOCAL-NEW',createdAt:new Date().toISOString()}]});return 'LOCAL-NEW'};
    export function useBookingData(){const data=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>state);return {...data,addBooking}}
    export const calculateOfficeEndDate=getOfficeRentalEndDate;
    export const user={id:'LOCAL-CLIENT',role:'client',name:'Local Client'};
    export const toast=message=>window.fixture.toasts.push(message);
    window.fixture={requests:[],submissions:[],toasts:[],occupied,
      set:publish,remote(patch){remote={...remote,...patch}},snapshot:()=>state,
      fail(){failNext=true},bad(){badNext=true},defer(){deferNext=true},pending:()=>pending.length,
      release(){pending.splice(0).forEach(resolve=>resolve())},
    };
    const nativeFetch=window.fetch.bind(window);
    window.fetch=async(input,options={})=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(url.origin===location.origin&&url.pathname==='/api/availability'){
        const p=Object.fromEntries(url.searchParams);window.fixture.requests.push(p);
        if(failNext){failNext=false;return new Response(JSON.stringify({error:'Local availability read failed.'}),{status:500})}
        const bookings=remote.bookings.map(b=>canAutomaticallyExpireBooking(b,[])?{...b,...automaticBookingExpiryFields(b)}:b);
        if(p.scope==='rooms'){
          const office=catalog.offices.find(o=>o.id===p.officeId);
          const body={officeId:p.officeId,officeRooms:Object.fromEntries(office.rooms.map(room=>[room.id,getOfficeRoomStatus(getCatalogAvailabilitySpace(catalog,'office',office.id,room.id),'2026-10-26',bookings,remote.maintenanceRecords,remote.officeRentals)]))};
          if(badNext){badNext=false;delete body.officeRooms}
          return new Response(JSON.stringify(body),{status:200});
        }
        const space=getCatalogAvailabilitySpace(catalog,p.category,p.venueId,p.spaceId);
        if(!space)throw Error('Invalid fixture resource ID');
        const body={space:{category:space.category,venueId:space.venueId,officeId:space.officeId,spaceId:space.spaceId},
          dates:calculateAvailabilityRange(space,p.from,p.to,bookings,remote.maintenanceRecords,remote.officeRentals,undefined,p.rentalTerm)};
        if(p.searchFrom)body.officeSearch={from:p.searchFrom,to:p.searchTo,
          earliestAvailableStartDate:findEarliestOfficeStartDate(space,p.searchFrom>getMinimumBookingDate()?p.searchFrom:getMinimumBookingDate(),p.searchTo,p.rentalTerm,bookings,remote.maintenanceRecords,remote.officeRentals)};
        if(badNext){badNext=false;delete body.officeSearch}
        if(deferNext){deferNext=false;await new Promise(resolve=>pending.push(resolve))}
        return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
      }
      if(url.origin!==location.origin||url.pathname.startsWith('/api/'))throw Error('Unexpected live service request');
      return nativeFetch(input,options);
    };
    // No external panorama assets are needed to test office scheduling.
    window.pannellum={viewer:()=>({destroy(){},on(){},startAutoRotate(){},stopAutoRotate(){}})};
  `,
  booking: `export {useBookingData,calculateOfficeEndDate} from 'virtual:office-state'`,
  auth: `import {user} from 'virtual:office-state';export const useAuth=()=>({user,isLoading:false})`,
  cms: `export {useCMS} from 'virtual:office-state'`,
  toast: `import {toast} from 'virtual:office-state';export const useToast=()=>({toast})`,
  token: `export const getAuthScope=async()=> 'LOCAL-FIXTURE';export const getAuthHeaders=async()=>({'Content-Type':'application/json','X-Local-Fixture':'office'})`,
  navigation: `const router={push(){},replace(){}};export const useRouter=()=>router`,
  firebase: `export const db={}`,
  firestore: `export const collection=()=>({}),query=ref=>ref,where=()=>({}),orderBy=()=>({}),getDocs=async()=>({forEach(){}})`,
  entry: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {ReserveDialog} from '@/src/modules/client/components/reserve-dialog';
    import '@/app/globals.css';import 'virtual:office-state';
    createRoot(document.getElementById('root')).render(React.createElement(ReserveDialog));
  `,
}
const mocks = [
  [/\/client\/contexts\/booking-context(?:\.tsx)?$/, "booking"],
  [/\/auth\/auth-context(?:\.tsx)?$/, "auth"],
  [/\/admin\/contexts\/cms-context(?:\.tsx)?$/, "cms"],
  [/\/hooks\/use-toast(?:\.tsx?)?$/, "toast"],
  [/(?:\/lib\/|^\.\/)auth-token(?:\.ts)?$/, "token"],
  [/^next\/navigation$/, "navigation"],
  [/\/lib\/firebase(?:\.ts)?$/, "firebase"],
  [/^firebase\/firestore$/, "firestore"],
]
const server = await createServer({
  configFile: false, envFile: false, envDir: false, root, cacheDir: join(output, "vite-cache"), logLevel: "silent",
  define: { "process.env.NEXT_PUBLIC_PERF_TRACE": JSON.stringify("0") },
  server: { host: "127.0.0.1", port: 0 },
  resolve: { alias: { "@": root, "@shared": join(root, "src/modules/shared") } },
  oxc: { jsx: { runtime: "automatic" } },
  css: { postcss: { plugins: [tailwindcss({ config: join(root, "tailwind.config.ts") })] } },
  optimizeDeps: { noDiscovery: true, include: [
    "react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react", "clsx", "tailwind-merge", "class-variance-authority",
    "@radix-ui/react-dialog", "@radix-ui/react-visually-hidden", "@radix-ui/react-select", "@radix-ui/react-collapsible", "@radix-ui/react-slot", "@radix-ui/react-label", "@radix-ui/react-checkbox",
  ] },
  plugins: [{
    name: "local-office-fixtures", enforce: "pre",
    resolveId(source) {
      if (source.startsWith("virtual:office-")) return `\0office-${source.slice("virtual:office-".length)}.tsx`
      const match = mocks.find(([pattern]) => pattern.test(source.replaceAll("\\", "/")))
      if (match) return `\0office-${match[1]}.tsx`
      if (/^(firebase|firebase-admin)(\/|$)/.test(source)) throw Error(`Unstubbed Firebase import: ${source}`)
    },
    load(id) { return modules[id.match(/^\0office-(.+)\.tsx$/)?.[1]] },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/__office")) return next()
        response.setHeader("Content-Type", "text/html")
        response.end(await vite.transformIndexHtml(request.url, '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--font-sans:Arial,sans-serif}body{min-height:200vh}</style></head><body class="font-sans"><div id="root"></div><script type="module" src="/@id/__x00__office-entry.tsx"></script></body></html>'))
      })
    },
  }],
})

let browser, page, current, failure
const passed = [], errors = [], warnings = []
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true, channel: process.env.PAYMENT_REVIEW_BROWSER_CHANNEL || undefined })
  const context = await browser.newContext({ locale: "en-US", timezoneId: "Asia/Manila", serviceWorkers: "block" })
  await context.route("**/*", route => {
    const url = new URL(route.request().url())
    return url.origin === origin || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort()
  })
  page = await context.newPage()
  page.setDefaultTimeout(10000)
  await page.clock.install({ time: new Date("2026-10-26T04:00:00Z") })
  page.on("pageerror", error => errors.push(error.message))
  page.on("console", message => {
    if (message.type() !== "error") return
    const text = message.text()
    if (text.startsWith("Warning: Function components cannot be given refs.")) warnings.push(text)
    else errors.push(text)
  })
  const visible = locator => locator.filter({ visible: true })
  const day = date => visible(page.getByRole("button", { name: `Select ${date}`, exact: true }))
  const proceed = () => visible(page.getByRole("button", { name: "Proceed to Details", exact: true }))
  const earliest = date => visible(page.getByText(date, { exact: true })).waitFor()
  const month = label => visible(page.getByRole("heading", { name: label, exact: true })).waitFor()
  const ready = date => page.waitForFunction(date => [...document.querySelectorAll(`button[aria-label="Select ${date}"]`)].some(el => !el.disabled), date)
  const room = async name => {
    await page.getByRole("button", { name: "Go Back", exact: true }).click()
    await page.getByRole("button", { name: `Select ${name}`, exact: true }).click()
  }
  const refresh = () => page.evaluate(() => window.dispatchEvent(new Event("focus")))
  const check = async (name, action) => {
    current.name = name
    await action()
    passed.push(`${current.width}x${current.height}: ${name}`)
    console.log(`PASS ${passed.at(-1)}`)
  }
  for (const [width, height] of [[1366, 768], [1280, 720], [390, 844], [320, 568]]) {
    current = { width, height, name: "open occupied office" }
    await page.setViewportSize({ width, height })
    await page.goto(`${origin}/__office`)
    await page.getByRole("button", { name: "Book Now", exact: true }).click()
    await page.getByRole("button", { name: "Book Office Space", exact: true }).click()
    await page.getByRole("button", { name: "Select Ground Floor Office", exact: true }).click()
    await check("occupied Room 1 stays visible and disabled; Rooms 2–8 are independently selectable", async () => {
      await page.waitForFunction(() => !document.querySelector('button[aria-label="Select Room 2"]').disabled)
      assert.equal(await page.getByRole("button", { name: "Select Room 1", exact: true }).isDisabled(), true)
      assert.equal(await page.getByRole("button", { name: "Select Room 1", exact: true }).getByText("Occupied", { exact: true }).count(), 1)
      await page.screenshot({ path: join(output, `${width}-room-selector.png`) })
      for (let number = 2; number <= 8; number++) {
        await page.getByRole("button", { name: `Select Room ${number}`, exact: true }).click()
        await ready("2026-11-26")
        await page.getByRole("button", { name: "Go Back", exact: true }).click()
      }
      await page.getByRole("button", { name: "Select Room 2", exact: true }).click()
    })
    await check("available office starts at the Manila minimum; full-term calendar and notice agree", async () => {
      await earliest("November 26, 2026"); await month("November 2026"); await ready("2026-11-26")
      assert.equal(await day("2026-11-25").isDisabled(), true)
      assert.equal(await proceed().isDisabled(), true)
      assert.equal(await page.getByText("Earliest available start date", { exact: true }).filter({ visible: true }).count(), 1)
      const dialog = page.getByRole("dialog", { name: "Reservation Modal", exact: true }), box = await dialog.boundingBox()
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height)
      assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false)
      await day("2026-11-26").click()
      assert.equal(await proceed().isEnabled(), true)
      await page.screenshot({ path: join(output, `${width}-next-valid-month.png`) })
    })
    await check("previous and later months remain inspectable without being forced back", async () => {
      await visible(page.getByRole("button", { name: "Next month", exact: true })).click()
      await month("December 2026"); await earliest("November 26, 2026")
      await visible(page.getByRole("button", { name: "Previous month", exact: true })).click()
      await ready("2026-11-26"); await day("2026-11-26").click()
    })
    await check("duration changes clear an invalid date and find a full one/two-year term after future maintenance", async () => {
      await page.evaluate(() => window.fixture.set({ maintenanceRecords: [{ type: "office", scope: "room", officeId: "building.A", spaceId: "room.2", status: "active", date: "2027-07-15" }] }))
      await ready("2026-11-26")
      await visible(page.getByRole("button", { name: "1 Year", exact: true })).click()
      await visible(page.getByRole("alert").filter({ hasText: "previous start date was cleared" })).waitFor()
      await earliest("July 16, 2027"); await month("July 2027"); await ready("2027-07-16")
      assert.equal(await proceed().isDisabled(), true)
      assert.equal(await day("2027-07-15").isDisabled(), true)
      await visible(page.getByRole("button", { name: "2 Years", exact: true })).click()
      await earliest("July 16, 2027"); await ready("2027-07-16")
      await day("2027-07-16").click()
      assert.equal(await proceed().isEnabled(), true)
    })
    await check("switching rooms uses stable IDs and leaves an unrelated room independently bookable", async () => {
      await room("Room 3")
      await earliest("November 26, 2026"); await month("November 2026"); await ready("2026-11-26")
      assert.equal(await day("2026-11-25").isDisabled(), true)
      assert.equal(await proceed().isDisabled(), true)
      await day("2026-11-26").click()
      assert.equal(await proceed().isEnabled(), true)
      const request = await page.evaluate(() => window.fixture.requests.filter(r => r.rentalTerm).at(-1))
      assert.equal(request.officeId, "building.A"); assert.equal(request.spaceId, "room.3"); assert.equal(request.rentalTerm, "6_months")
    })
    await check("building maintenance invalidates all its rooms and removal refreshes the notice", async () => {
      await page.evaluate(() => window.fixture.set({ maintenanceRecords: [{ type: "office", scope: "building", officeId: "building.A", spaceId: "building.A", status: "active", date: "2027-01-02" }] }))
      await earliest("January 3, 2027"); await month("January 2027"); await ready("2027-01-03")
      assert.equal(await proceed().isDisabled(), true)
      await page.evaluate(() => window.fixture.set({ maintenanceRecords: [] }))
      await earliest("November 26, 2026"); await month("November 2026"); await ready("2026-11-26")
    })
    await check("availability errors and malformed responses disable selection and recover with Retry", async () => {
      for (const mode of ["fail", "bad"]) {
        await page.evaluate(mode => window.fixture[mode](), mode); await refresh()
        await visible(page.getByRole("button", { name: "Retry availability", exact: true })).waitFor()
        assert.equal(await day("2026-11-26").isDisabled(), true)
        assert.equal(await proceed().isDisabled(), true)
        await visible(page.getByRole("button", { name: "Retry availability", exact: true })).click()
        await ready("2026-11-26")
      }
    })
    await check("lease transition and pending cancellation retain occupancy; completion releases on refresh", async () => {
      await page.getByRole("button", { name: "Go Back", exact: true }).click()
      await page.evaluate(() => window.fixture.set({ bookings: [{ ...window.fixture.occupied, status: "completed" }], officeRentals: [{ officeId: "building.A", officeSpaceId: "room.1", leaseStatus: "Active Lease", startDate: "2020-01-01", endDate: "2021-01-01" }] }))
      await page.getByRole("button", { name: "Select Room 1", exact: true }).getByText("Occupied", { exact: true }).waitFor()
      assert.equal(await page.getByRole("button", { name: "Select Room 1", exact: true }).isDisabled(), true)
      await page.evaluate(() => window.fixture.set({ officeRentals: [], bookings: [{ ...window.fixture.occupied, status: "cancellation_requested", cancellationRequested: true }] }))
      await page.getByRole("button", { name: "Select Room 1", exact: true }).getByText("Reserved", { exact: true }).waitFor()
      assert.equal(await page.getByRole("button", { name: "Select Room 1", exact: true }).isDisabled(), true)
      await page.evaluate(() => window.fixture.set({ bookings: [{ ...window.fixture.occupied, status: "cancelled" }] }))
      await page.waitForFunction(() => !document.querySelector('button[aria-label="Select Room 1"]').disabled)
      await page.getByRole("button", { name: "Select Room 1", exact: true }).click()
      await earliest("November 26, 2026"); await ready("2026-11-26")
      await page.evaluate(() => window.fixture.remote({ bookings: [{ ...window.fixture.occupied, status: "pending", isSlotSecured: false, paymentStatus: "unpaid", amountPaid: 0, createdAt: new Date().toISOString() }] }))
      await page.clock.runFor(30100)
      await page.getByRole("button", { name: "Select Room 1", exact: true }).getByText("Reserved", { exact: true }).waitFor()
      assert.equal(await page.getByRole("button", { name: "Select Room 1", exact: true }).isDisabled(), true)
      await page.evaluate(() => window.fixture.remote({ bookings: [{ ...window.fixture.occupied, status: "pending", isSlotSecured: false, paymentStatus: "unpaid", amountPaid: 0, createdAt: "2026-10-23T04:00:00Z" }] }))
      await refresh()
      await page.waitForFunction(() => !document.querySelector('button[aria-label="Select Room 1"]').disabled)
      await page.getByRole("button", { name: "Select Room 1", exact: true }).click()
      await earliest("November 26, 2026"); await month("November 2026"); await ready("2026-11-26")
    })
    await check("empty searches stop at the horizon and allow an explicit later period", async () => {
      await page.evaluate(() => window.fixture.set({ maintenanceRecords: [{ type: "office", scope: "room", officeId: "building.A", spaceId: "room.1", status: "active", date: "2026-11-01", endDate: "2032-12-31" }] }))
      await visible(page.getByText(/No valid start date found from/)).waitFor()
      const before = await page.evaluate(() => window.fixture.requests.length)
      await page.clock.runFor(1000)
      assert.equal(await page.evaluate(() => window.fixture.requests.length), before, "search must not loop through months indefinitely")
      const previous = await page.evaluate(() => window.fixture.requests.filter(r => r.searchFrom).at(-1))
      await visible(page.getByRole("button", { name: "Search later start dates", exact: true })).click()
      await visible(page.getByText(/No valid start date found from/)).waitFor()
      const next = await page.evaluate(() => window.fixture.requests.filter(r => r.searchFrom).at(-1))
      assert.ok(next.searchFrom > previous.searchTo)
      assert.ok((Date.parse(next.searchTo) - Date.parse(next.searchFrom)) / 86400000 < 1096)
      assert.equal(await proceed().isDisabled(), true)
    })
    await check("final details and nested Terms stay usable with the parent background locked", async () => {
      await page.evaluate(() => window.fixture.set({ bookings: [], officeRentals: [], maintenanceRecords: [] }))
      await room("Room 2"); await earliest("November 26, 2026"); await ready("2026-11-26")
      await day("2026-11-26").click(); await proceed().click()
      await page.getByPlaceholder("e.g. Acme Corp / Juan Dela Cruz").fill("Local Tenant")
      await page.locator("select").selectOption("tech")
      await page.getByText("Terms & Conditions", { exact: true }).click()
      const terms = page.getByRole("dialog", { name: "Terms & Conditions", exact: true })
      await terms.getByRole("button", { name: "I Understand", exact: true }).click()
      assert.equal(await page.locator("body").evaluate(el => el.hasAttribute("data-scroll-locked")), true)
      const submit = page.getByRole("button", { name: "Submit Reservation Request", exact: true })
      await submit.scrollIntoViewIfNeeded()
      assert.equal(await submit.isEnabled(), true)
      const dialog = page.getByRole("dialog", { name: "Reservation Modal", exact: true }), box = await dialog.boundingBox()
      assert.ok(box.y >= 0 && box.y + box.height <= height)
      assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false)
      const button = await submit.boundingBox()
      assert.ok(button.y >= box.y && button.y + button.height <= height)
      await page.screenshot({ path: join(output, `${width}-details-bottom-controls.png`) })
      await submit.click()
      const confirmation = page.getByRole("dialog", { name: "Confirm Booking Details", exact: true })
      await confirmation.getByRole("button", { name: "Confirm Booking", exact: true }).click()
      await page.waitForFunction(() => window.fixture.submissions.length === 1)
      const saved = await page.evaluate(() => window.fixture.submissions[0])
      assert.equal(saved.spaceId, "room.2"); assert.equal(saved.officeRentalTerm, "6_months")
      assert.equal(saved.endDate, "2027-05-26"); assert.equal(saved.startTime, ""); assert.equal(saved.endTime, "")
      await page.waitForFunction(() => !document.body.hasAttribute("data-scroll-locked"))
    })
  }
  assert.deepEqual(errors, [])
  console.log(`Office browser verification: ${passed.length} scenarios passed. Artifacts: ${output}`)
} catch (error) {
  failure = { ...current, message: error.message }
  await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {})
  console.error(`FAIL ${current?.width}px: ${current?.name}: ${error.message}`)
  throw error
} finally {
  await writeFile(join(output, "results.json"), JSON.stringify({ status: failure ? "failed" : "passed", passed, failure, errors, warnings,
    scope: "Real reservation component, hook, client and shared rules; local synthetic service boundaries, not live Firebase persistence." }, null, 2))
  console.log(`Office browser artifacts: ${output}`)
  await browser?.close()
  await server.close()
}
