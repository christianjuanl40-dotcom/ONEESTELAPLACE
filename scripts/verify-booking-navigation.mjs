/**
 * Local-only Chromium coverage for the Dashboard-to-My Bookings auto-open
 * contract. The actual client dashboard, bookings page, ReserveDialog, and
 * shared UI are rendered; auth, catalog, Firestore, and booking services are
 * local fixtures.
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
const output = await mkdtemp(join(process.env.BOOKING_NAVIGATION_TEMP_DIR || tmpdir(), "one-estela-booking-navigation-"))

const modules = {
  state: `
    import {useSyncExternalStore} from 'react';
    const params=new URLSearchParams(location.search);
    const initialState=params.get('state')||'ready';
    let state={bookings:[],paymentRecords:[],maintenanceRecords:[],officeRentals:[],isLoading:initialState==='loading',dataError:initialState==='error'?'Fixture booking/payment read failed':null,dataErrors:initialState==='error'?{bookings:'Fixture booking read failed'}:{}};
    const listeners=new Set();
    const subscribe=listener=>{listeners.add(listener);return()=>listeners.delete(listener)};
    const getState=()=>state;
    const emit=()=>listeners.forEach(listener=>listener());
    const update=patch=>{state={...state,...patch};emit()};
    const actions={
      addBooking:async payload=>{window.fixture.submissions.push(payload);return 'LOCAL-BOOKING'},
      getUserBookings:()=>state.bookings,
      requestCancellation:async()=>null,
      issueReceipt:async()=>null,
      requestModification:async()=>null,
      retryData:()=>{update({dataError:null,dataErrors:{},isLoading:true});queueMicrotask(()=>update({isLoading:false}))},
      _registerDataNeed:()=>{},
    };
    const resolveData=()=>update({dataError:null,dataErrors:{},isLoading:false});
    export const calculateOfficeEndDate=(startDate,term)=>startDate;
    export const getCancellationMessage=()=>'';
    export const isCancellationAllowed=()=>false;
    export const isRefundEligible=()=>false;
    export const canShowCancellationNotice=()=>false;
    export const canRequestCancellation=()=>false;
    export function useBookingData(){const value=useSyncExternalStore(subscribe,getState,getState);return {...value,...actions,isMaintenanceLoading:false,maintenanceError:null,maintenanceDates:[]}}
    export const useBookings=useBookingData;
    window.fixture={...(window.fixture||{}),submissions:[],snapshot:getState,resolveData};
  `,
  auth: `
    const fixtureUser={id:'CLIENT-BOOKING-NAV',role:'client',name:'Fixture Client',email:'client@example.test',permissions:{}};
    const fixtureAuth={user:fixtureUser,isLoading:false,initializationError:null};
    export const useAuth=()=>fixtureAuth;
  `,
  cms: `
    const cmsData={venues:[{id:'venue.A',name:'Fixture Hall',price:10000,capacity:'50',description:'Fixture event venue',image:'/placeholder.jpg'}],offices:[{id:'office.A',name:'Fixture Office',price:5000,rooms:[{id:'room.A',name:'Room A'}]}],faqs:[],pastClientBookings:[],homepage:{}};
    export const useCMS=()=>({cmsData,offices:cmsData.offices,getOfficeRooms:id=>cmsData.offices.find(item=>item.id===id)?.rooms||[]});
  `,
  toast: `export const useToast=()=>({toast:value=>{window.fixture.lastToast=value}});`,
  notifications: `const fixtureNotifications={notifications:[],markByBookingId:()=>{}};export const useNotifications=()=>fixtureNotifications;`,
  navigation: `
    import {useSyncExternalStore} from 'react';
    const subscribe=listener=>{window.addEventListener('popstate',listener);return()=>window.removeEventListener('popstate',listener)};
    const getLocation=()=>location.pathname+location.search;
    const useLocation=()=>useSyncExternalStore(subscribe,getLocation,getLocation);
    const navigate=(value,replace)=>{
      const next=new URL(value,location.href);
      if(replace) history.replaceState({},'',next.pathname+next.search+next.hash);
      else history.pushState({},'',next.pathname+next.search+next.hash);
      window.dispatchEvent(new PopStateEvent('popstate'));
    };
    const navigation={push:value=>navigate(value,false),replace:value=>navigate(value,true),prefetch:()=>{},refresh:()=>{}};
    window.fixture=window.fixture||{};
    window.fixture.navigation=navigation;
    export const useRouter=()=>navigation;
    export const useSearchParams=()=>{useLocation();return new URLSearchParams(location.search)};
    export const usePathname=()=>{useLocation();return location.pathname};
  `,
  link: `
    import React from 'react';
    const Link=React.forwardRef(function Link({href,children,onClick,...props},ref){
      return React.createElement('a',{...props,href,ref,onClick:event=>{
        onClick?.(event);
        if(event.defaultPrevented)return;
        event.preventDefault();
        history.pushState({},'',href);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }},children);
    });
    export default Link;
  `,
  firebase: `export const db={};export const auth={currentUser:null};`,
  firestore: `
    export const collection=()=>({});export const query=()=>({});export const where=()=>({});export const orderBy=()=>({});export const limit=()=>({});export const doc=()=>({});
    export const getDoc=async()=>({exists:()=>false});export const getDocs=async()=>({docs:[],forEach:()=>{}});export const addDoc=async()=>({id:'LOCAL'});
  `,
  entry: `
    import React,{useSyncExternalStore} from 'react';import {createRoot} from 'react-dom/client';
    import ClientDashboard from '@/app/portal/page';
    import MyBookingsPage from '@/app/portal/bookings/page';
    import '@/app/globals.css';import 'virtual:booking-navigation-state';
    const subscribe=listener=>{window.addEventListener('popstate',listener);return()=>window.removeEventListener('popstate',listener)};
    const getLocation=()=>location.pathname+location.search;
    function App(){
      const route=useSyncExternalStore(subscribe,getLocation,getLocation);
      const path=new URL(route,location.origin).pathname;
      const view=path==='/portal/bookings'||(path==='/__booking-navigation'&&new URLSearchParams(location.search).get('view')==='bookings')?'bookings':'dashboard';
      return React.createElement(view==='bookings'?MyBookingsPage:ClientDashboard);
    }
    createRoot(document.getElementById('root')).render(React.createElement(App));
  `,
}

const mocks = [
  [/^virtual:booking-navigation-state$/, "state"],
  [/\/auth\/auth-context(?:\.tsx?)?$/, "auth"],
  [/\/client\/contexts\/booking-context(?:\.tsx?)?$/, "state"],
  [/\/admin\/contexts\/cms-context(?:\.tsx?)?$/, "cms"],
  [/\/contexts\/notification-context(?:\.tsx?)?$/, "notifications"],
  [/\/hooks\/use-toast(?:\.tsx?)?$/, "toast"],
  [/^next\/navigation$/, "navigation"],
  [/^next\/link$/, "link"],
  [/\/lib\/firebase(?:\.ts)?$/, "firebase"],
  [/^firebase\/firestore$/, "firestore"],
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
      "react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime",
      "lucide-react", "clsx", "tailwind-merge", "class-variance-authority", "jszip",
      "@radix-ui/react-dialog", "@radix-ui/react-visually-hidden", "@radix-ui/react-select",
      "@radix-ui/react-collapsible", "@radix-ui/react-slot", "@radix-ui/react-label",
      "@radix-ui/react-checkbox", "@radix-ui/react-progress", "@radix-ui/react-tooltip",
    ],
  },
  plugins: [{
    name: "local-booking-navigation-fixtures",
    enforce: "pre",
    resolveId(source) {
      if (source.startsWith("virtual:booking-navigation-")) return `\0booking-navigation-${source.slice("virtual:booking-navigation-".length)}.tsx`
      const match = mocks.find(([pattern]) => pattern.test(source.replaceAll("\\", "/")))
      return match ? `\0booking-navigation-${match[1]}.tsx` : undefined
    },
    load(id) {
      return modules[id.match(/^\0booking-navigation-(.+)\.tsx$/)?.[1]]
    },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        const requestPath = new URL(request.url || "/", "http://booking-navigation.local").pathname
        if (!["/__booking-navigation", "/portal", "/portal/bookings"].includes(requestPath)) return next()
        response.setHeader("Content-Type", "text/html")
        response.end(await vite.transformIndexHtml(request.url, '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__booking-navigation-entry.tsx"></script></body></html>'))
      })
    },
  }],
})

let browser
const passed = []
const errors = []
const blocked = []
let documentLoads = 0
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true, channel: process.env.BOOKING_NAVIGATION_BROWSER_CHANNEL || undefined })
  const context = await browser.newContext({ locale: "en-US", timezoneId: "Asia/Manila", serviceWorkers: "block" })
  await context.addInitScript(() => {
    // The category-step assertion does not need the optional 360° viewer.
    // Mark it as locally available so the fixture makes no external requests.
    window.pannellum = {
      viewer: () => ({
        destroy() {},
        startAutoRotate() {},
        stopAutoRotate() {},
      }),
    }
  })
  await context.route("**/*", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === origin && url.pathname === "/api/availability") {
      const params = url.searchParams
      if (params.get("scope") === "rooms") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ officeId: params.get("officeId"), officeRooms: { "room.A": "available" } }),
        })
      }
      const from = params.get("from")
      const to = params.get("to")
      const dates = {}
      if (from && to) {
        for (let day = new Date(`${from}T00:00:00Z`); day <= new Date(`${to}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + 1)) {
          const date = day.toISOString().slice(0, 10)
          dates[date] = {
            status: "available",
            availableSlots: [{ label: "08:00", startMinutes: 480, endMinutes: 840, startTimeLabel: "8:00 AM", endTimeLabel: "2:00 PM" }],
            occupiedIntervals: [],
          }
        }
      }
      const spaceId = params.get("spaceId") || params.get("venueId")
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          space: { category: params.get("category"), venueId: params.get("venueId"), officeId: params.get("officeId"), spaceId },
          dates,
          ...(params.get("rentalTerm") && params.get("searchFrom") && params.get("searchTo")
            ? { officeSearch: { from: params.get("searchFrom"), to: params.get("searchTo"), earliestAvailableStartDate: params.get("searchFrom") } }
            : {}),
        }),
      })
    }
    if (url.origin === origin || ["data:", "blob:"].includes(url.protocol)) return route.continue()
    blocked.push(`${request.method()} ${url.origin}${url.pathname}`)
    return route.abort()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on("load", () => { documentLoads += 1 })
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() !== "error") return
    const text = message.text()
    if (text.includes("Failed to load Pannellum library")) return
    errors.push(text)
  })

  const waitForDashboard = async (state = "ready") => {
    await page.goto(`${origin}/portal?state=${state}`)
    try {
      if (state === "error") await page.getByRole("button", { name: "New Booking", exact: true }).waitFor()
      else await page.getByRole("heading", { name: "Dashboard", exact: true }).waitFor()
    } catch (error) {
      console.error("Dashboard fixture HTML:", (await page.locator("body").innerText()).slice(0, 2000))
      console.error("Dashboard fixture errors:", errors)
      throw error
    }
  }

  const waitForBookings = async () => {
    await page.goto(`${origin}/portal/bookings?state=ready`)
    await page.getByRole("heading", { name: "My Bookings", exact: true }).waitFor()
    await page.getByText("No current booking found.", { exact: true }).waitFor()
  }

  const assertCategoryWorkflow = async (label, expectedPath = "/portal/bookings") => {
    await page.getByRole("heading", { name: "Select Category", exact: true }).waitFor()
    assert.equal(new URL(page.url()).pathname, expectedPath, `${label}: destination pathname is incorrect`)
    assert.equal(new URL(page.url()).searchParams.get("newBooking"), null, `${label}: navigation intent was not consumed`)
    assert.equal(await page.getByRole("heading", { name: "Select Category", exact: true }).count(), 1, `${label}: modal opened more than once`)
    assert.equal(await page.getByRole("button", { name: "Book Event Venue", exact: true }).count(), 1)
    assert.equal(await page.getByRole("button", { name: "Book Office Space", exact: true }).count(), 1)
  }

  const closeReserveDialog = async (method = "close") => {
    if (method === "escape") await page.keyboard.press("Escape")
    else await page.getByRole("button", { name: "Close", exact: true }).click()
    await page.getByRole("heading", { name: "Select Category", exact: true }).waitFor({ state: "detached" })
  }

  const assertDashboardNavigationIntent = async (label, triggerName) => {
    await waitForDashboard()
    const trigger = page.getByRole("button", { name: triggerName, exact: true }).first()
    assert.equal(await trigger.count(), 1, `${label}: ${triggerName} trigger missing`)
    const loadCount = documentLoads
    await trigger.click()
    await assertCategoryWorkflow(label)
    assert.equal(documentLoads, loadCount, `${label}: clicking ${triggerName} caused a document reload`)
    await page.getByRole("button", { name: "Book Event Venue", exact: true }).click()
    await page.getByRole("heading", { name: "Our Venues", exact: true }).waitFor()
    await closeReserveDialog()
    passed.push(label)
    console.log(`PASS ${label}`)
  }

  const assertBookingDialog = async (label, triggerName) => {
    await waitForBookings()
    assert.equal(await page.getByRole("heading", { name: "Select Category", exact: true }).count(), 0, `${label}: direct navigation opened the modal`)
    const loadCount = documentLoads
    const trigger = page.getByRole("button", { name: triggerName, exact: true }).first()
    assert.equal(await trigger.count(), 1, `${label}: ${triggerName} trigger missing`)
    await page.getByRole("button", { name: triggerName, exact: true }).click()
    await assertCategoryWorkflow(label)
    assert.equal(documentLoads, loadCount, `${label}: clicking ${triggerName} caused a document reload`)
    await closeReserveDialog()
    passed.push(label)
    console.log(`PASS ${label}`)
  }

  const assertDashboardIntentDuringState = async (label, state) => {
    await waitForDashboard(state)
    const trigger = page.getByRole("button", { name: "New Booking", exact: true })
    const loadCount = documentLoads
    await trigger.click()
    await assertCategoryWorkflow(label)
    assert.equal(documentLoads, loadCount, `${label}: navigation caused a document reload`)
    if (state === "loading") {
      await page.getByText("Loading your bookings…", { exact: true }).waitFor()
      await closeReserveDialog("escape")
    } else {
      await closeReserveDialog("escape")
      await page.getByRole("alert").waitFor()
      assert.match(await page.getByRole("alert").innerText(), /could not be loaded/i)
      await page.getByRole("button", { name: "New Booking", exact: true }).click()
      await page.getByRole("heading", { name: "Select Category", exact: true }).waitFor()
      await closeReserveDialog()
    }
    assert.equal(new URL(page.url()).pathname, "/portal/bookings")
    passed.push(label)
    console.log(`PASS ${label}`)
  }

  await assertDashboardIntentDuringState("dashboard loading opens bookings modal before list readiness", "loading")
  await assertDashboardIntentDuringState("dashboard listener failure preserves modal access", "error")

  await assertDashboardNavigationIntent("dashboard New Booking navigates and auto-opens ReserveDialog", "New Booking")
  await assertDashboardNavigationIntent("dashboard empty-state Book Now navigates and auto-opens ReserveDialog", "Book Now")

  await assertBookingDialog("direct My Bookings navigation leaves modal closed", "New Booking")
  await assertBookingDialog("My Bookings empty-state Book Now opens the existing modal", "Book Now")

  await page.goto(`${origin}/portal/bookings?newBooking=1&bookingId=preserve-me&history=true`)
  await assertCategoryWorkflow("direct navigation intent opens once and preserves unrelated query parameters")
  assert.equal(new URL(page.url()).searchParams.get("bookingId"), "preserve-me")
  assert.equal(new URL(page.url()).searchParams.get("history"), "true")
  await closeReserveDialog()
  await page.reload()
  await page.getByRole("heading", { name: "My Bookings", exact: true }).waitFor()
  assert.equal(await page.getByRole("heading", { name: "Select Category", exact: true }).count(), 0, "refresh reopened a consumed navigation intent")
  passed.push("close, refresh, and consumed-intent behavior")
  console.log("PASS close, refresh, and consumed-intent behavior")

  await waitForBookings()
  await page.getByRole("button", { name: "New Booking", exact: true }).click()
  await page.getByRole("heading", { name: "Select Category", exact: true }).waitFor()
  await closeReserveDialog("escape")
  await page.getByRole("button", { name: "New Booking", exact: true }).click()
  await page.getByRole("heading", { name: "Select Category", exact: true }).waitFor()
  await closeReserveDialog()
  passed.push("My Bookings close controls and immediate reopen")
  console.log("PASS My Bookings close controls and immediate reopen")

  await assertDashboardNavigationIntent("back/forward navigation does not reopen a consumed intent", "New Booking")
  await page.goBack()
  await page.getByRole("heading", { name: "Dashboard", exact: true }).waitFor()
  await page.goForward()
  await page.getByRole("heading", { name: "My Bookings", exact: true }).waitFor()
  assert.equal(await page.getByRole("heading", { name: "Select Category", exact: true }).count(), 0, "forward navigation reopened a consumed intent")

  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    await waitForDashboard()
    await page.getByRole("button", { name: "New Booking", exact: true }).click()
    await page.getByRole("heading", { name: "Select Category", exact: true }).waitFor()
    assert.equal(new URL(page.url()).pathname, "/portal/bookings", `dashboard auto-open navigated incorrectly at ${width}px`)
    const metrics = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }))
    assert.ok(metrics.scrollWidth <= metrics.width + 1, `dashboard booking dialog overflows at ${width}px`)
    await closeReserveDialog("escape")
  }
  passed.push("dashboard to bookings auto-open remains usable at 320/375/768/1024/1440px")
  console.log("PASS dashboard to bookings auto-open remains usable at 320/375/768/1024/1440px")

  if (blocked.length > 0) {
    const unexpected = blocked.filter((request) => !request.includes("cdn.jsdelivr.net"))
    if (unexpected.length > 0) throw new Error(`Fixture attempted unexpected external requests: ${unexpected.join(", ")}`)
  }
  if (errors.length > 0) throw new Error(`Browser runtime errors: ${errors.join(" | ")}`)
  console.log(`Booking navigation browser checks passed (${passed.length} scenarios). Local fixtures only. Artifacts: ${output}`)
} finally {
  await browser?.close()
  await server.close()
}
