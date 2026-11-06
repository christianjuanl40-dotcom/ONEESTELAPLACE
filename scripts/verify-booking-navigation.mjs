/**
 * Local-only Chromium coverage for client New Booking entry points.
 * The actual client dashboard, bookings page, ReserveDialog, and shared UI are
 * rendered; auth, catalog, Firestore, and booking services are local fixtures.
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
    const state={bookings:[],paymentRecords:[],maintenanceRecords:[],officeRentals:[],isLoading:false,dataError:null,dataErrors:{}};
    const listeners=new Set();
    const subscribe=listener=>{listeners.add(listener);return()=>listeners.delete(listener)};
    const getState=()=>state;
    const actions={
      addBooking:async payload=>{window.fixture.submissions.push(payload);return 'LOCAL-BOOKING'},
      getUserBookings:()=>state.bookings,
      requestCancellation:async()=>null,
      issueReceipt:async()=>null,
      requestModification:async()=>null,
      retryData:()=>{},
      _registerDataNeed:()=>{},
    };
    export const calculateOfficeEndDate=(startDate,term)=>startDate;
    export const getCancellationMessage=()=>'';
    export const isCancellationAllowed=()=>false;
    export const isRefundEligible=()=>false;
    export const canShowCancellationNotice=()=>false;
    export const canRequestCancellation=()=>false;
    export function useBookingData(){const value=useSyncExternalStore(subscribe,getState,getState);return {...value,...actions,isMaintenanceLoading:false,maintenanceError:null,maintenanceDates:[]}}
    export const useBookings=useBookingData;
    window.fixture={submissions:[],snapshot:getState};
  `,
  auth: `
    export const useAuth=()=>({user:{id:'CLIENT-BOOKING-NAV',role:'client',name:'Fixture Client',email:'client@example.test',permissions:{}},isLoading:false,initializationError:null});
  `,
  cms: `
    const cmsData={venues:[{id:'venue.A',name:'Fixture Hall',price:10000,capacity:'50',description:'Fixture event venue',image:'/placeholder.jpg'}],offices:[{id:'office.A',name:'Fixture Office',price:5000,rooms:[{id:'room.A',name:'Room A'}]}],faqs:[],pastClientBookings:[],homepage:{}};
    export const useCMS=()=>({cmsData,offices:cmsData.offices,getOfficeRooms:id=>cmsData.offices.find(item=>item.id===id)?.rooms||[]});
  `,
  toast: `export const useToast=()=>({toast:value=>{window.fixture.lastToast=value}});`,
  notifications: `export const useNotifications=()=>({notifications:[],markByBookingId:()=>{}});`,
  navigation: `
    export const useRouter=()=>({push:value=>window.fixture.navigation.push(value),replace:value=>window.fixture.navigation.push(value),prefetch:()=>{},refresh:()=>{}});
    export const useSearchParams=()=>new URLSearchParams(location.search);
    export const usePathname=()=>location.pathname;
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
    import React from 'react';import {createRoot} from 'react-dom/client';
    import ClientDashboard from '@/app/portal/page';
    import MyBookingsPage from '@/app/portal/bookings/page';
    import '@/app/globals.css';import 'virtual:booking-navigation-state';
    const view=new URLSearchParams(location.search).get('view');
    createRoot(document.getElementById('root')).render(React.createElement(view==='bookings'?MyBookingsPage:ClientDashboard));
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
        if (!request.url?.startsWith("/__booking-navigation")) return next()
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
const documentNavigations = []
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true, channel: process.env.BOOKING_NAVIGATION_BROWSER_CHANNEL || undefined })
  const context = await browser.newContext({ locale: "en-US", timezoneId: "Asia/Manila", serviceWorkers: "block" })
  await context.addInitScript(() => {
    // The category-step assertion does not need the optional 360° viewer.
    // Mark it as locally available so the fixture makes no external requests.
    window.pannellum = {}
  })
  await context.route("**/*", (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === origin || ["data:", "blob:"].includes(url.protocol)) return route.continue()
    blocked.push(`${request.method()} ${url.origin}${url.pathname}`)
    return route.abort()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) documentNavigations.push(frame.url())
  })
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() !== "error") return
    const text = message.text()
    if (text.includes("Failed to load Pannellum library")) return
    errors.push(text)
  })

  const waitForDashboard = async () => {
    await page.goto(`${origin}/__booking-navigation?view=dashboard`)
    try {
      await page.getByRole("heading", { name: "Dashboard", exact: true }).waitFor()
    } catch (error) {
      console.error("Dashboard fixture HTML:", (await page.locator("body").innerText()).slice(0, 2000))
      console.error("Dashboard fixture errors:", errors)
      throw error
    }
  }

  const waitForBookings = async () => {
    await page.goto(`${origin}/__booking-navigation?view=bookings`)
    await page.getByRole("heading", { name: "My Bookings", exact: true }).waitFor()
  }

  const assertBookingDialog = async (label, triggerName) => {
    const initialPath = new URL(page.url()).pathname
    const trigger = page.getByRole("button", { name: triggerName, exact: true }).first()
    assert.equal(await trigger.count(), 1, `${label}: ${triggerName} trigger missing`)
    const navigationCount = documentNavigations.length
    await trigger.click()
    await page.getByRole("heading", { name: "Select Category", exact: true }).waitFor()
    assert.equal(new URL(page.url()).pathname, initialPath, `${label}: clicking ${triggerName} navigated away`)
    assert.equal(documentNavigations.length, navigationCount, `${label}: clicking ${triggerName} caused a document navigation`)
    assert.equal(await page.getByRole("button", { name: "Book Event Venue", exact: true }).count(), 1)
    assert.equal(await page.getByRole("button", { name: "Book Office Space", exact: true }).count(), 1)
    await page.getByRole("button", { name: "Close", exact: true }).click()
    await page.getByRole("heading", { name: "Select Category", exact: true }).waitFor({ state: "detached" })
    await trigger.click()
    await page.getByRole("heading", { name: "Select Category", exact: true }).waitFor()
    assert.equal(new URL(page.url()).pathname, initialPath, `${label}: repeat click navigated away`)
    assert.equal(documentNavigations.length, navigationCount, `${label}: repeat click caused a document navigation`)
    await page.getByRole("button", { name: "Close", exact: true }).click()
    await page.getByRole("heading", { name: "Select Category", exact: true }).waitFor({ state: "detached" })
    passed.push(label)
    console.log(`PASS ${label}`)
  }

  await waitForDashboard()
  await assertBookingDialog("dashboard New Booking opens the usable category workflow", "New Booking")
  await assertBookingDialog("dashboard Book Now opens the usable category workflow", "Book Now")

  await waitForBookings()
  await assertBookingDialog("My Bookings New Booking opens the usable category workflow", "New Booking")

  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    await waitForDashboard()
    await page.getByRole("button", { name: "New Booking", exact: true }).click()
    await page.getByRole("heading", { name: "Select Category", exact: true }).waitFor()
    const metrics = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }))
    assert.ok(metrics.scrollWidth <= metrics.width + 1, `dashboard booking dialog overflows at ${width}px`)
    await page.getByRole("button", { name: "Close", exact: true }).click()
    await page.getByRole("heading", { name: "Select Category", exact: true }).waitFor({ state: "detached" })
  }
  passed.push("dashboard New Booking remains usable at 320/375/768/1024/1440px")
  console.log("PASS dashboard New Booking remains usable at 320/375/768/1024/1440px")

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
