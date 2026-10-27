/** Local-only Chromium checks of the actual AdminBookings page and BookingProvider.
 * Only service boundaries are fixtures. Simulated writes never leave browser memory.
 */
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"
import tailwindcss from "tailwindcss"
import { chromium } from "playwright"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const output = await mkdtemp(join(process.env.BOOKING_MAINTENANCE_TEMP_DIR || tmpdir(), "booking-maintenance-"))
console.log(`Local maintenance browser artifacts: ${output}`)
const modules = {
  state: `
    import {useSyncExternalStore} from 'react';
    import {calculateAvailabilityRange,calculateAvailabilityForDate} from '@/src/modules/shared/lib/availability';
    import {getCatalogAvailabilitySpace} from '@/src/modules/shared/lib/resource-identity';
    import {canAutomaticallyExpireBooking,automaticBookingExpiryFields} from '@/src/modules/shared/lib/booking-lifecycle';
    const date=day=>'2030-05-'+String(day).padStart(2,'0');
    const event=(id,day,patch={})=>({id,bookingCategory:'venue',venueId:'venue.A',spaceId:'venue.A',
      venue:'Historical fixture label',eventName:'Local scheduling fixture',eventType:'Custom office celebration',
      date:date(day),startTime:'08:00',endTime:'14:00',status:'confirmed',paymentStatus:'paid',
      totalPrice:1000,createdAt:'2030-05-01T00:00:00Z',...patch});
    const data={bookings:[event('LOCAL-CANCELLED',19,{status:'cancelled'})],officeRentals:[],maintenanceRecords:[],payments:[]};
    const subscriptions=new Set(),held=new Set(['maintenanceRecords','officeRentals']);
    const snapshot=name=>{
      const docs=data[name].map(row=>({id:row.id,data:()=>({...row})}));
      return {docs,size:docs.length,forEach:fn=>docs.forEach(fn),docChanges:()=>[]};
    };
    const emit=name=>{for(const sub of subscriptions)if(sub.name===name&&!held.has(name))sub.next(snapshot(name))};
    export function onSnapshot(ref,options,next,error){
      if(typeof options==='function'){error=next;next=options}
      const sub={name:ref.path,next,error};subscriptions.add(sub);
      queueMicrotask(()=>{if(subscriptions.has(sub)&&!held.has(sub.name))next(snapshot(sub.name))});
      return()=>subscriptions.delete(sub);
    }
    export const getDocs=async ref=>snapshot(ref.path);
    let catalog={venues:[{id:'venue.A',name:'Custom Hall'},{id:'venue.A-copy',name:'Custom Hall Annex'}],offices:[
      {id:'office.A',name:'Custom Building',rooms:[{id:'room.shared',name:'Custom Room'},{id:'room.other',name:'Other Room'}]},
      {id:'office.B',name:'Other Building',rooms:[{id:'room.shared',name:'Custom Room'}]},
    ]};
    const listeners=new Set();
    export function useCMS(){
      const cmsData=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>catalog);
      return {cmsData,getOfficeRooms:id=>cmsData.offices.find(o=>o.id===id)?.rooms||[]};
    }
    export const user={id:'LOCAL-ADMIN',role:'admin',permissions:{bookings:true}};
    export const toast=value=>window.fixture.toasts.push(value);
    export const forbidden=()=>{window.fixture.unexpected.push('Unexpected service/write');throw Error('Unexpected service/write')};
    const pending=[],pendingGets=[];
    let deferNextGet=true;
    const availability={requests:[],responses:[],defer(){deferNextGet=true},pending:()=>pendingGets.length,
      finish(status=200,body){
        const next=pendingGets.shift();if(!next)throw Error('No deferred availability GET');
        next.resolve(reply(body===undefined?next.body:body,status));
      },
    };
    const reply=(body,status=200)=>{availability.responses.push(body);return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})};
    window.fixture={data,event,date,availability,ledger:[],toasts:[],requests:[],unexpected:[],pending:()=>pending.length,
      localStatus(day){return calculateAvailabilityForDate(getCatalogAvailabilitySpace(catalog,'venue','venue.A'),date(day),data.bookings).status},
      set(name,rows){data[name]=rows;emit(name)},
      release(name){held.delete(name);emit(name)},
      failMaintenance(){for(const sub of subscriptions)if(sub.name==='maintenanceRecords')sub.error({code:'fixture-unavailable'})},
      rename(){
        catalog={...catalog,venues:[{id:'venue.A-copy',name:'Custom Hall'},{id:'venue.A',name:'Renamed Office Celebration Hall'}]};
        listeners.forEach(fn=>fn());
      },
      renameRooms(){
        catalog={...catalog,offices:[
          {id:'office.B',name:'Custom Building',rooms:[{id:'room.shared',name:'Renamed Custom Room'}]},
          {id:'office.A',name:'Renamed Custom Building',rooms:[{id:'room.other',name:'Custom Room'},{id:'room.shared',name:'Renamed Custom Room'}]},
        ]};listeners.forEach(fn=>fn());
      },
      finish(status=200,override){
        if(pending.length!==1)throw Error('Expected exactly one deferred local write');
        const {request,resolve}=pending.shift();let body=override;
        if(body===undefined&&status===200){
          if(request.method==='POST'){
            const records=request.body.records.map((record,index)=>({...record,id:'LOCAL-MAINT-'+request.number+'-'+index,
              status:'active',spaceName:'Historical fixture label',createdAt:'2030-05-10T04:00:00Z'}));
            data.maintenanceRecords=[...data.maintenanceRecords,...records];body={records};
          }else{
            data.maintenanceRecords=data.maintenanceRecords.filter(record=>!request.body.ids.includes(record.id));
            body={ids:request.body.ids};
          }
        }
        // Do not emit a snapshot here: the real provider must apply the acknowledgement itself.
        resolve(new Response(JSON.stringify(body||{error:'Local fixture rejected the write.'}),
          {status,headers:{'Content-Type':'application/json'}}));
      },
    };
    const nativeFetch=window.fetch.bind(window);
    window.fetch=(input,options={})=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(url.origin===location.origin&&url.pathname==='/api/availability'&&(!options.method||options.method==='GET')){
        const params=Object.fromEntries(url.searchParams),request={params,aborted:false};availability.requests.push(request);
        const building=params.category==='office'&&params.spaceId===params.officeId;
        const space=getCatalogAvailabilitySpace(catalog,params.category,params.venueId,building?undefined:params.category==='office'?params.spaceId:undefined,building);
        if(!space)throw Error('Invalid local availability resource descriptor');
        const projected=data.bookings.map(booking=>{
          const ids=[booking.id,booking.bookingCode].filter(Boolean);
          const ledger=window.fixture.ledger.filter(payment=>ids.includes(payment.bookingId)||ids.includes(payment.bookingCode));
          return canAutomaticallyExpireBooking(booking,ledger)?{...booking,...automaticBookingExpiryFields(booking)}:booking;
        });
        const body={space:{category:space.category,venueId:space.venueId,officeId:space.officeId,spaceId:space.spaceId},
          dates:calculateAvailabilityRange(space,params.from,params.to,projected,data.maintenanceRecords,data.officeRentals)};
        if(deferNextGet){
          deferNextGet=false;options.signal?.addEventListener('abort',()=>{request.aborted=true},{once:true});
          // Deliberately resolve aborted fixtures late to check the hook's stale-response guard.
          return new Promise(resolve=>pendingGets.push({resolve,body}));
        }
        return Promise.resolve(reply(body));
      }
      if(url.origin===location.origin&&url.pathname==='/api/maintenance'&&['POST','DELETE'].includes(options.method)){
        const request={number:window.fixture.requests.length+1,method:options.method,body:JSON.parse(options.body)};
        window.fixture.requests.push(request);return new Promise(resolve=>pending.push({request,resolve}));
      }
      if(url.origin!==location.origin||url.pathname.startsWith('/api/'))return Promise.reject(forbidden());
      return nativeFetch(input,options);
    };
  `,
  auth: `import {user} from 'virtual:maintenance-state';export const useAuth=()=>({user,isLoading:false})`,
  cms: `export {useCMS} from 'virtual:maintenance-state'`,
  toast: `import {toast} from 'virtual:maintenance-state';export const useToast=()=>({toast})`,
  notifications: `const value={markByBookingId:()=>{}};export const useNotifications=()=>value`,
  notificationService: `export {forbidden as createNotification} from 'virtual:maintenance-state'`,
  token: `export const getAuthScope=async()=> 'LOCAL-FIXTURE';export const getAuthHeaders=async()=>({'Content-Type':'application/json','X-Local-Fixture':'maintenance'})`,
  navigation: `const router={replace:()=>{},push:()=>{}},params=new URLSearchParams();export const useRouter=()=>router;export const useSearchParams=()=>params`,
  firebase: `export const db={}`,
  firestore: `
    export {onSnapshot,getDocs,forbidden as writeBatch,forbidden as runTransaction} from 'virtual:maintenance-state';
    export const collection=(_,path)=>({path}),doc=()=>({}),query=ref=>ref,orderBy=()=>({}),where=()=>({});
  `,
  entry: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import AdminBookings from '@/app/(admin)/dashboard/bookings/page';
    import {BookingProvider,useBookings} from '@/src/modules/client/contexts/booking-context';
    import '@/app/globals.css';import 'virtual:maintenance-state';
    function Observe(){window.fixture.provider=useBookings();return null}
    createRoot(document.getElementById('root')).render(React.createElement(BookingProvider,null,React.createElement(Observe),React.createElement(AdminBookings)));
  `,
}
const mocks = [
  [/\/auth\/auth-context(?:\.tsx)?$/, "auth"],
  [/\/admin\/contexts\/cms-context(?:\.tsx)?$/, "cms"],
  [/\/hooks\/use-toast(?:\.tsx?)?$/, "toast"],
  [/\/contexts\/notification-context(?:\.tsx)?$/, "notifications"],
  [/\/lib\/notifications(?:\.ts)?$/, "notificationService"],
  [/(?:\/lib\/|^\.\/)auth-token(?:\.ts)?$/, "token"],
  [/^next\/navigation$/, "navigation"],
  [/\/lib\/firebase(?:\.ts)?$/, "firebase"],
  [/^firebase\/firestore$/, "firestore"],
]
const server = await createServer({
  configFile: false, envFile: false, envDir: false, root, cacheDir: join(output, "vite-cache"), logLevel: "error",
  define: { "process.env.NEXT_PUBLIC_PERF_TRACE": JSON.stringify("0") },
  server: { host: "127.0.0.1", port: 0, forwardConsole: false },
  resolve: { alias: { "@": root, "@shared": join(root, "src/modules/shared") } },
  oxc: { jsx: { runtime: "automatic" } },
  css: { postcss: { plugins: [tailwindcss({ config: join(root, "tailwind.config.ts") })] } },
  optimizeDeps: { noDiscovery: true, include: [
    "react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react", "clsx", "tailwind-merge", "class-variance-authority",
    "@radix-ui/react-dialog", "@radix-ui/react-visually-hidden", "@radix-ui/react-select", "@radix-ui/react-slot", "@radix-ui/react-label", "@radix-ui/react-tooltip", "@radix-ui/react-tabs",
  ] },
  plugins: [{
    name: "local-booking-maintenance-fixtures", enforce: "pre",
    resolveId(source) {
      if (source.startsWith("virtual:maintenance-")) return `\0maintenance-${source.slice("virtual:maintenance-".length)}.tsx`
      const match = mocks.find(([pattern]) => pattern.test(source.replaceAll("\\", "/")))
      if (match) return `\0maintenance-${match[1]}.tsx`
      if (/^(firebase|firebase-admin)(\/|$)/.test(source)) throw new Error(`Unstubbed Firebase import: ${source}`)
    },
    load(id) { return modules[id.match(/^\0maintenance-(.+)\.tsx$/)?.[1]] },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/__booking-maintenance")) return next()
        const html = await vite.transformIndexHtml(request.url, '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--font-sans:Arial,sans-serif}body{background:#f8fafc}</style></head><body class="font-sans"><div id="root"></div><script type="module" src="/@id/__x00__maintenance-entry.tsx"></script></body></html>')
        response.setHeader("Content-Type", "text/html")
        response.end(html)
      })
    },
  }],
})

let browser, page, current, failure
const passed = [], errors = [], warnings = [], blocked = []
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true, channel: process.env.PAYMENT_REVIEW_BROWSER_CHANNEL || undefined })
  const context = await browser.newContext({ locale: "en-US", timezoneId: "Asia/Manila", serviceWorkers: "block" })
  await context.route("**/*", route => {
    const request = route.request(), url = new URL(request.url())
    if ((url.origin === origin && !url.pathname.startsWith("/api/") && request.method() === "GET") || ["data:", "blob:"].includes(url.protocol)) return route.continue()
    blocked.push(`${request.method()} ${url.origin}${url.pathname}`)
    return route.abort()
  })
  page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on("pageerror", error => errors.push(error.message))
  page.on("console", message => {
    if (message.type() !== "error") return
    const text = message.text()
    if (text === "[MaintenanceRecords] Listener failed: fixture-unavailable") return
    if (text.startsWith("[Maintenance] Data read failed") && text.includes("fixture-unavailable")) return
    // Existing React 18/Radix ref warnings are outside this maintenance-only change.
    if (text.startsWith("Warning: Function components cannot be given refs.") && /\n\s+at (Button|DialogOverlay) \(/.test(text)) warnings.push(text)
    else errors.push(text)
  })
  await page.clock.setFixedTime(new Date("2030-05-10T04:00:00Z"))
  const modal = () => page.getByRole("dialog", { name: "Schedule Maintenance", exact: true })
  const day = number => modal().getByRole("button", { name: String(number), exact: true })
  const save = () => modal().getByRole("button", { name: "Block Date", exact: true })
  const reason = () => modal().locator("#maintenance-reason")
  const selected = () => modal().getByRole("button", { name: "Clear All", exact: true })
  const rows = () => modal().getByTitle("Remove maintenance", { exact: true })
  const providerRecords = () => page.evaluate(() => window.fixture.provider.maintenanceRecords)
  const requests = () => page.evaluate(() => window.fixture.requests)
  const getRequests = () => page.evaluate(() => window.fixture.availability.requests)
  const statusIs = async (number, title) => day(number).and(modal().getByTitle(title, { exact: true })).waitFor()
  const finishGet = async (status = 200, body) => {
    await page.evaluate(({ status, body }) => window.fixture.availability.finish(status, body), { status, body })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  }
  const pendingGet = async () => {
    await page.waitForFunction(() => window.fixture.availability.pending() === 1)
    await modal().getByRole("status").getByText("Loading availability...", { exact: true }).waitFor()
  }
  const lastToast = async title => page.waitForFunction(title => window.fixture.toasts.at(-1)?.title === title, title)
  const finish = async (status = 200, body) => {
    const count = await page.evaluate(() => window.fixture.toasts.length)
    await page.evaluate(({ status, body }) => window.fixture.finish(status, body), { status, body })
    await page.waitForFunction(count => window.fixture.toasts.length === count + 1, count)
  }
  const pending = async () => {
    await page.waitForFunction(() => window.fixture.pending() === 1)
    assert.equal(await modal().getByRole("button", { name: "Saving...", exact: true }).isDisabled(), true)
  }
  const cleared = async () => {
    assert.equal(await selected().count(), 0, "resource changes must discard selected dates")
    assert.equal(await save().isDisabled(), true)
  }
  const screenshot = name => page.screenshot({ path: join(output, `${current.width}-${name}.png`), animations: "disabled" })
  const check = async (name, run) => {
    current.name = name
    await run()
    passed.push(`${current.width}px: ${name}`)
    console.log(`PASS ${passed.at(-1)}`)
  }

  for (const [width, height] of [[390, 844], [1366, 768], [1280, 720], [320, 568]]) {
    current = { width, height, name: "mount actual page/provider" }
    await page.setViewportSize({ width, height })
    await page.goto(`${origin}/__booking-maintenance`)
    await page.getByRole("button", { name: "Maintenance Calendar", exact: true }).click()
    await modal().getByLabel("Select Venue", { exact: true }).selectOption("venue.A")

    await check("maintenance loading disables calendar and saving", async () => {
      await modal().getByRole("status").getByText("Loading maintenance records...", { exact: true }).waitFor()
      assert.equal(await day(12).isDisabled(), true)
      assert.equal(await save().isDisabled(), true)
      assert.equal(await page.evaluate(() => window.fixture.provider.isMaintenanceLoading), true)
      assert.deepEqual(await requests(), [])
      await screenshot("loading")
    })
    await check("other schedule loading still prevents saving after maintenance loads", async () => {
      await page.evaluate(() => window.fixture.release("maintenanceRecords"))
      await page.waitForFunction(() => !window.fixture.provider.isMaintenanceLoading)
      assert.equal(await page.evaluate(() => window.fixture.provider.isLoading), true)
      assert.equal(await day(12).getAttribute("title"), "Availability could not be confirmed yet")
      assert.equal(await day(12).isDisabled(), true)
      assert.equal(await save().isDisabled(), true)
      await page.evaluate(() => window.fixture.release("officeRentals"))
      await page.waitForFunction(() => !window.fixture.provider.isLoading)
    })
    await check("deferred GET, not an empty local schedule, controls readiness", async () => {
      await pendingGet()
      assert.equal(await day(12).isDisabled(), true)
      assert.equal(await save().isDisabled(), true)
      assert.equal(await modal().getByRole("alert").count(), 0)
       assert.deepEqual((await getRequests()).at(-1).params, { category: "venue", venueId: "venue.A", from: "2030-05-01", to: "2030-05-31", spaceId: "venue.A" })
      await screenshot("get-loading")
      await finishGet()
      await statusIs(12, "Available")
      assert.deepEqual(await requests(), [])
    })
    await check("renamed/reordered CMS venue remains selected by exact ID", async () => {
      await page.evaluate(() => window.fixture.rename())
      const venue = modal().getByLabel("Select Venue", { exact: true })
      assert.equal(await venue.inputValue(), "venue.A")
      assert.equal(await venue.locator("option:checked").textContent(), "Renamed Office Celebration Hall")
      await day(12).click()
      await day(13).click()
      await reason().fill("Retain this local fixture draft")
    })
    await check("GET loading/error preserves selected dates/reason and prevents writes", async () => {
      const count = (await getRequests()).length
      await reason().fill("Retain this local fixture draft")
      assert.equal((await getRequests()).length, count, "draft edits must not create request loops")
      await page.evaluate(() => { window.fixture.availability.defer(); window.dispatchEvent(new Event("focus")) })
      await pendingGet()
      assert.equal(await save().isDisabled(), true)
      assert.equal(await day(12).isDisabled(), true)
      await modal().getByText("Selected (2 Dates)", { exact: true }).waitFor()
      await finishGet(409, { error: "Local fixture: ambiguous schedule reference requires review." })
      await modal().getByRole("alert").getByText("Local fixture: ambiguous schedule reference requires review.", { exact: true }).waitFor()
      assert.equal(await save().isDisabled(), true)
      assert.equal(await day(12).isDisabled(), true)
      assert.equal(await reason().inputValue(), "Retain this local fixture draft")
      assert.deepEqual(await requests(), [])
      await screenshot("get-error-draft")
      await page.evaluate(() => window.dispatchEvent(new Event("focus")))
      await statusIs(12, "Available")
      assert.equal(await save().isEnabled(), true)
    })
    await check("malformed empty GET surfaces an error and is not treated as available", async () => {
      await page.evaluate(() => { window.fixture.availability.defer(); window.dispatchEvent(new Event("focus")) })
      await pendingGet()
      await finishGet(200, { dates: {} })
      await modal().getByRole("alert").getByText("The availability response could not be confirmed. Please retry.", { exact: true }).waitFor()
      assert.equal(await modal().getByRole("status").count(), 0)
      assert.equal(await day(12).isDisabled(), true)
      assert.equal(await save().isDisabled(), true)
      await modal().getByText("Selected (2 Dates)", { exact: true }).waitFor()
      await page.evaluate(() => window.dispatchEvent(new Event("focus")))
      await statusIs(12, "Available")
    })
    await check("deferred save has no optimistic success or list rows", async () => {
      await save().click()
      await pending()
      assert.equal(await reason().inputValue(), "Retain this local fixture draft")
      assert.equal(await reason().isDisabled(), true)
      assert.equal(await selected().isDisabled(), true)
      assert.deepEqual(await providerRecords(), [])
      assert.equal(await rows().count(), 0)
      assert.deepEqual(await page.evaluate(() => window.fixture.toasts), [])
      await page.keyboard.press("Escape")
      await modal().waitFor()
      assert.deepEqual((await requests())[0].body.records, [12, 13].map(day => ({ type: "venue", scope: "venue", venueId: "venue.A", spaceId: "venue.A", date: `2030-05-${day}`, reason: "Retain this local fixture draft" })))
      await screenshot("deferred-save")
    })
    await check("failed save retains both dates/reason and creates no row", async () => {
      await finish(409)
      await lastToast("Maintenance Save Failed")
      assert.equal(await reason().inputValue(), "Retain this local fixture draft")
      await modal().getByText("Selected (2 Dates)", { exact: true }).waitFor()
      assert.deepEqual((await modal().locator("ul li").allTextContents()).map(text => text.replace(/^[^A-Za-z]+/, "")), ["May 12, 2030", "May 13, 2030"])
      assert.equal(await save().isEnabled(), true)
      assert.equal(await rows().count(), 0)
      assert.deepEqual(await providerRecords(), [])
      await screenshot("failed-save-draft")
    })
    await check("actual provider rejects malformed save acknowledgement", async () => {
      await save().click()
      await pending()
      await finish(200, { records: [] })
      await page.waitForFunction(() => window.fixture.toasts.at(-1)?.description === "The maintenance server returned an invalid save response.")
      assert.equal(await reason().inputValue(), "Retain this local fixture draft")
      await modal().getByText("Selected (2 Dates)", { exact: true }).waitFor()
      assert.equal(await rows().count(), 0)
      assert.deepEqual(await providerRecords(), [])
    })
    await check("acknowledged save alone adds rows and clears the draft", async () => {
      await save().click()
      await pending()
      assert.deepEqual((await requests()).at(-1).body, (await requests())[0].body)
      assert.equal(await page.evaluate(() => window.fixture.toasts.some(t => t.title === "Maintenance Saved")), false)
      await finish()
      await lastToast("Maintenance Saved")
      assert.equal((await providerRecords()).length, 2)
      assert.equal(await rows().count(), 2)
      assert.equal(await reason().inputValue(), "")
      await cleared()
      await statusIs(12, "Maintenance")
      await rows().first().scrollIntoViewIfNeeded()
      await screenshot("acknowledged-venue-list")
    })
    await check("single delete failure and invalid acknowledgement retain the exact row", async () => {
      const before = await providerRecords()
      for (const [status, body] of [[409, undefined], [200, { ids: ["NOT-THE-TARGET"] }]]) {
        await rows().first().click()
        await page.waitForFunction(() => window.fixture.pending() === 1)
        assert.deepEqual((await requests()).at(-1).body, { ids: [before[0].id] })
        assert.deepEqual(await providerRecords(), before)
        await finish(status, body)
        await lastToast("Maintenance Removal Failed")
        await save().waitFor()
        assert.deepEqual(await providerRecords(), before)
        assert.equal(await rows().count(), 2)
      }
      assert.equal(await page.evaluate(() => window.fixture.toasts.some(t => t.title === "Maintenance Removed")), false)
    })
    await check("venue and type changes clear selected dates", async () => {
      await day(18).click()
      await modal().getByLabel("Select Venue", { exact: true }).selectOption("venue.A-copy")
      await cleared()
      await day(18).click()
      await modal().getByLabel("Space Type", { exact: true }).selectOption("office")
      await cleared()
    })
    await check("renamed custom room uses exact parent/room IDs, not labels or order", async () => {
      await modal().getByLabel("Select Building", { exact: true }).selectOption("office.A")
      await modal().getByLabel("Select Room", { exact: true }).selectOption("room.shared")
      await day(14).click()
      await page.evaluate(() => window.fixture.renameRooms())
      assert.equal(await modal().getByLabel("Select Building", { exact: true }).inputValue(), "office.A")
      assert.equal(await modal().getByLabel("Select Room", { exact: true }).inputValue(), "room.shared")
      assert.equal(await modal().getByLabel("Select Building", { exact: true }).locator("option:checked").textContent(), "Renamed Custom Building")
      assert.equal(await modal().getByLabel("Select Room", { exact: true }).locator("option:checked").textContent(), "Renamed Custom Room")
      await save().click()
      await pending()
      assert.deepEqual((await requests()).at(-1).body.records, [{ type: "office", scope: "room", venueId: "office.A", officeId: "office.A", spaceId: "room.shared", date: "2030-05-14", reason: "" }])
      await finish()
      await lastToast("Maintenance Saved")
      await modal().locator("p").filter({ hasText: /^Renamed Custom Room$/ }).waitFor()
      await statusIs(14, "Maintenance")
      assert.equal((await getRequests()).at(-1).params.officeId, "office.A")
      assert.equal((await getRequests()).at(-1).params.spaceId, "room.shared")
    })
    await check("room/scope changes clear dates; building writes target all rooms", async () => {
      await day(18).click()
      await modal().getByLabel("Select Room", { exact: true }).selectOption("room.other")
      await cleared()
      await statusIs(14, "Available")
      await day(18).click()
      await modal().getByLabel("Maintenance Scope", { exact: true }).selectOption("building")
      await cleared()
      assert.equal(await modal().getByLabel("Select Room", { exact: true }).count(), 0)
      await statusIs(14, "Maintenance")
      assert.equal((await getRequests()).at(-1).params.spaceId, "office.A")
      await day(15).click()
      await save().click()
      await pending()
      assert.deepEqual((await requests()).at(-1).body.records, [{ type: "office", scope: "building", venueId: "office.A", officeId: "office.A", spaceId: "office.A", date: "2030-05-15", reason: "" }])
      await finish()
      await lastToast("Maintenance Saved")
      await modal().getByText("Entire Building", { exact: true }).waitFor()
      await modal().getByLabel("Maintenance Scope", { exact: true }).selectOption("room")
      await modal().getByLabel("Select Room", { exact: true }).selectOption("room.other")
      await statusIs(15, "Maintenance")
      await screenshot("room-building-scope")
    })
    await check("building change clears dates and does not leak another building's blocks", async () => {
      await day(18).click()
      await modal().getByLabel("Select Building", { exact: true }).selectOption("office.B")
      await cleared()
      await modal().getByLabel("Select Room", { exact: true }).selectOption("room.shared")
      await statusIs(14, "Available")
      await statusIs(15, "Available")
    })
    await check("rental/maintenance snapshot changes immediately refresh GET without resetting the draft", async () => {
      await day(21).click()
      await reason().fill("Keep across schedule snapshots")
      for (const [dataset, active, title] of [["officeRentals", "Active", "Existing Reservation"], ["maintenanceRecords", "active", "Maintenance"]]) {
        for (const status of [active, "completed"]) {
          const count = (await getRequests()).length
          await page.evaluate(({ dataset, status }) => {
            const f = window.fixture
            f.availability.defer()
            const record = { id: "LOCAL-SNAPSHOT-" + dataset, type: "office", scope: "room", venueId: "office.B", officeId: "office.B", spaceId: "room.shared", date: f.date(21), status, leaseStatus: status }
            f.set(dataset, [...f.data[dataset].filter(r => r.id !== record.id), record])
          }, { dataset, status })
          await pendingGet()
          assert.equal((await getRequests()).length, count + 1)
          assert.equal(await save().isDisabled(), true)
          await finishGet()
          await statusIs(21, status === active ? title : "Available")
          assert.equal(await reason().inputValue(), "Keep across schedule snapshots")
          await modal().getByText("Selected (1 Date)", { exact: true }).waitFor()
        }
      }
      await selected().click()
      await reason().fill("")
    })
    await check("Few blocks full-day maintenance, including a selected date becoming booked", async () => {
      await modal().getByLabel("Space Type", { exact: true }).selectOption("venue")
      await modal().getByLabel("Select Venue", { exact: true }).selectOption("venue.A")
      await day(18).click()
      const before = (await requests()).length
      const getCount = (await getRequests()).length
      await page.evaluate(() => {
        const f = window.fixture
        f.availability.defer()
        f.set("bookings", [f.event("LOCAL-ACTIVE", 18),
          ...["cancelled", "canceled", "completed", "declined", "expired", "rental_expired"].map((status, i) => f.event("LOCAL-TERMINAL-" + i, 19, { status })),
          f.event("LOCAL-OTHER", 20, { venueId: "venue.A-copy", spaceId: "venue.A-copy" })])
      })
      await page.waitForFunction(() => window.fixture.provider.bookings.length === 8)
      await pendingGet()
      assert.equal((await getRequests()).length, getCount + 1)
      assert.equal(await save().isDisabled(), true)
      await finishGet()
      await statusIs(18, "Few: an existing reservation prevents full-day maintenance")
      assert.equal(await day(18).isDisabled(), true)
      await save().click()
      await lastToast("Date(s) Already Booked")
      assert.equal((await requests()).length, before, "Few rejection must not invoke the write boundary")
      await modal().getByText("Selected (1 Date)", { exact: true }).waitFor()
      await day(18).scrollIntoViewIfNeeded()
      await screenshot("few-rejected")
    })
    await check("all six terminal booking states and unrelated venue are ignored", async () => {
      await selected().click()
      for (const number of [19, 20]) {
        assert.equal(await day(number).getAttribute("title"), "Available")
        assert.equal(await day(number).isEnabled(), true)
      }
      await day(19).click()
      await save().click()
      await pending()
      await finish()
      await lastToast("Maintenance Saved")
      await statusIs(19, "Maintenance")
    })
    await check("resource/month changes abort and replace GET; late stale responses are ignored", async () => {
      for (const change of ["resource", "month"]) {
        await page.evaluate(() => { window.fixture.availability.defer(); window.dispatchEvent(new Event("focus")) })
        await pendingGet()
        const index = (await getRequests()).length - 1
        if (change === "resource") await modal().getByLabel("Select Venue", { exact: true }).selectOption("venue.A-copy")
        else await modal().getByRole("button", { name: "Next month", exact: true }).click()
        await statusIs(20, change === "resource" ? "Few: an existing reservation prevents full-day maintenance" : "Available")
        assert.equal((await getRequests())[index].aborted, true)
        assert.equal((await getRequests()).at(-1).params[change === "resource" ? "venueId" : "from"], change === "resource" ? "venue.A-copy" : "2030-06-01")
        await finishGet()
        await statusIs(20, change === "resource" ? "Few: an existing reservation prevents full-day maintenance" : "Available")
      }
      await modal().getByRole("button", { name: "Previous month", exact: true }).click()
      await modal().getByLabel("Select Venue", { exact: true }).selectOption("venue.A")
      await statusIs(22, "Available")
    })
    await check("GET ledger expiry projection frees old pending holds without changing the local booking", async () => {
      await page.evaluate(() => {
        const f = window.fixture
        f.ledger = [{ id: "LOCAL-LEDGER", bookingId: "LOCAL-RECEIVED-HOLD", status: "Incomplete", amount: 100, amountReceived: 100, term: "Down Payment" }]
        f.set("bookings", [...f.data.bookings,
          f.event("LOCAL-EXPIRED-HOLD", 22, { status: "pending", paymentStatus: "unpaid" }),
          f.event("LOCAL-RECEIVED-HOLD", 23, { status: "pending", paymentStatus: "unpaid" }),
        ])
      })
      await statusIs(22, "Available")
      await statusIs(23, "Few: an existing reservation prevents full-day maintenance")
      assert.equal(await page.evaluate(() => window.fixture.localStatus(22)), "few", "the old local calculation would still block this date")
      assert.equal(await page.evaluate(() => window.fixture.provider.bookings.find(b => b.id === "LOCAL-EXPIRED-HOLD").status), "pending")
      await day(22).click()
      assert.equal(await save().isEnabled(), true)
      assert.equal(await day(23).isDisabled(), true)
      await screenshot("ledger-expired-pending-selectable")
      await selected().click()
    })
    await check("cross-month selections recheck off-screen dates through GET before writing", async () => {
      await day(25).click()
      await modal().getByRole("button", { name: "Next month", exact: true }).click()
      await day(25).click()
      await page.evaluate(() => window.fixture.availability.defer())
      const count = (await requests()).length
      await save().click()
      await page.waitForFunction(() => window.fixture.availability.pending() === 1)
      assert.equal((await requests()).length, count)
      assert.equal(await modal().getByRole("button", { name: "Saving...", exact: true }).isDisabled(), true)
      assert.equal((await getRequests()).at(-1).params.from, "2030-05-25")
      await finishGet(500, { error: "Local fixture off-screen schedule unavailable." })
      await lastToast("Maintenance Save Failed")
      await modal().getByText("Selected (2 Dates)", { exact: true }).waitFor()
      assert.equal((await requests()).length, count)
      await save().click()
      await pending()
      assert.deepEqual((await requests()).at(-1).body.records.map(r => r.date), ["2030-05-25", "2030-06-25"])
      await finish()
      await lastToast("Maintenance Saved")
      await modal().getByRole("button", { name: "Previous month", exact: true }).click()
      await statusIs(25, "Maintenance")
    })
    await check("filtered Delete All freezes every exact ID across pages; failure retains confirmation", async () => {
      await page.evaluate(() => {
        const f = window.fixture, record = (id, patch = {}) => ({ id, type: "office", scope: "room", venueId: "office.A", officeId: "office.A", spaceId: "room.shared", status: "active", date: "2030-06-01", reason: id, ...patch })
        f.set("maintenanceRecords", [
          ...f.data.maintenanceRecords,
          ...Array.from({ length: 6 }, (_, i) => record("TARGET-" + i, { date: "2030-06-0" + (i + 1) })),
          record("OTHER-ROOM", { spaceId: "room.other" }), record("OTHER-BUILDING", { venueId: "office.B", officeId: "office.B" }),
          record("WHOLE-BUILDING", { scope: "building", spaceId: "office.A" }), record("INACTIVE", { status: "cancelled" }),
        ])
      })
      await modal().getByLabel("Space Type", { exact: true }).selectOption("office")
      await modal().getByLabel("Filter Location", { exact: true }).selectOption(JSON.stringify(["office", "office.A", "room.shared"]))
      // The earlier room save also belongs to this exact filter, not just the six seeded rows.
      assert.equal(await rows().count(), 5)
      await modal().getByRole("button", { name: "Next", exact: true }).click()
      assert.equal(await rows().count(), 2)
      const before = await providerRecords()
      const target = before.filter(r => r.type === "office" && r.scope === "room" && r.officeId === "office.A" && r.spaceId === "room.shared" && r.status === "active").map(r => r.id).sort()
      assert.equal(target.length, 7)
      await modal().getByRole("button", { name: "Delete All", exact: true }).click()
      const confirm = page.getByRole("dialog", { name: "Delete 7 maintenance records?", exact: true })
      await confirm.getByText(/Renamed Custom Building - Renamed Custom Room/).waitFor()
      await page.evaluate(() => {
        const f = window.fixture
        f.set("maintenanceRecords", [...f.data.maintenanceRecords, { ...f.data.maintenanceRecords.find(r => r.id === "TARGET-0"), id: "LATE-TARGET", reason: "Added after confirmation" }])
      })
      await screenshot("filtered-delete-confirmation")
      await confirm.getByRole("button", { name: "Delete All", exact: true }).click()
      await page.waitForFunction(() => window.fixture.pending() === 1)
      assert.deepEqual((await requests()).at(-1).body.ids.slice().sort(), target)
      assert.equal(await confirm.getByRole("button", { name: "Deleting...", exact: true }).isDisabled(), true)
      await finish(409)
      await lastToast("Maintenance Removal Failed")
      assert.equal(await confirm.isVisible(), true)
      assert.deepEqual((await providerRecords()).map(r => r.id).sort(), [...before.map(r => r.id), "LATE-TARGET"].sort())
    })
    await check("acknowledged filtered delete preserves other rooms/buildings/scopes/types/inactive/late rows", async () => {
      const before = await providerRecords(), target = (await requests()).at(-1).body.ids
      const confirm = page.getByRole("dialog", { name: "Delete 7 maintenance records?", exact: true })
      await confirm.getByRole("button", { name: "Delete All", exact: true }).click()
      await page.waitForFunction(() => window.fixture.pending() === 1)
      assert.deepEqual((await requests()).at(-1).body.ids, target)
      await finish()
      await lastToast("Maintenance Cleared")
      await confirm.waitFor({ state: "hidden" })
      assert.equal(await page.locator("body").evaluate(el => el.hasAttribute("data-scroll-locked")), true, "closing the confirmation must keep the parent scroll lock")
      assert.deepEqual(await providerRecords(), before.filter(r => !target.includes(r.id)))
      assert.equal(await rows().count(), 1)
      await modal().getByText(/Added after confirmation/).waitFor()
      await rows().first().scrollIntoViewIfNeeded()
      await screenshot("filtered-delete-survivors")
    })
    await check("maintenance listener error keeps draft/list and disables mutations", async () => {
      await modal().getByLabel("Select Building", { exact: true }).selectOption("office.B")
      await modal().getByLabel("Select Room", { exact: true }).selectOption("room.shared")
      await day(21).click()
      await reason().fill("Keep on listener failure")
      const before = await providerRecords(), count = (await requests()).length
      await page.evaluate(() => window.fixture.failMaintenance())
      await modal().getByRole("alert").getByText("Maintenance could not be loaded. Check your connection and retry data loading.", { exact: true }).waitFor()
      assert.equal(await save().isDisabled(), true)
      assert.equal(await day(21).isDisabled(), true)
      assert.equal(await modal().getByRole("button", { name: "Delete All", exact: true }).isDisabled(), true)
      assert.equal(await rows().first().isDisabled(), true)
      assert.equal(await reason().inputValue(), "Keep on listener failure")
      await modal().getByText("Selected (1 Date)", { exact: true }).waitFor()
      assert.deepEqual(await providerRecords(), before)
      assert.equal((await requests()).length, count)
      await modal().getByRole("alert").scrollIntoViewIfNeeded()
      await screenshot("listener-error")
    })
    await check("responsive modal fits viewport, scrolls, and has no runtime/live-service errors", async () => {
      const box = await modal().boundingBox()
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height)
      assert.equal(await modal().evaluate(el => el.scrollWidth > el.clientWidth + 1), false)
      assert.equal(await page.locator("html").evaluate(el => el.scrollWidth > el.clientWidth + 1), false)
      const body = modal().getByRole("region", { name: "Maintenance content" })
      assert.equal(await body.evaluate(el => el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY)), true)
      assert.equal(await modal().evaluate(el => [...el.querySelectorAll("*")].filter(node => node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)).length), 1, "one scrolling body, no competing list/fieldset scrollbars")
      await body.evaluate(el => { el.scrollTop = el.scrollHeight })
      await rows().last().scrollIntoViewIfNeeded()
      const row = await rows().last().boundingBox(), footer = await save().boundingBox()
      assert.ok(row.y >= box.y && row.y + row.height <= footer.y, "bottom records and controls must be reachable")
      assert.ok(footer.y >= box.y && footer.y + footer.height <= height, "footer stays visible")
      await screenshot("viewport-bottom-controls")
      const backgroundY = await page.evaluate(() => window.scrollY)
      await page.mouse.move(8, height / 2)
      await page.mouse.wheel(0, 400)
      await page.waitForTimeout(100)
      assert.equal(await page.evaluate(() => window.scrollY), backgroundY, "wheel gestures outside the dialog must not scroll the background")
      await modal().getByRole("button", { name: "Close", exact: true }).click()
      await page.waitForFunction(() => !document.body.hasAttribute("data-scroll-locked"))
      assert.notEqual(await page.locator("body").evaluate(el => getComputedStyle(el).overflow), "hidden", "last close restores background scrolling")
      await page.mouse.wheel(0, 400)
      await page.waitForFunction(y => window.scrollY > y, backgroundY)
      assert.deepEqual(await page.evaluate(() => window.fixture.unexpected), [])
      assert.equal(await page.evaluate(() => JSON.stringify(window.fixture.availability.responses).includes("LOCAL-")), false, "GET fixtures expose schedule primitives, not booking IDs")
      assert.ok((await getRequests()).every(r => Object.keys(r.params).every(key => ["category", "venueId", "officeId", "spaceId", "name", "roomName", "from", "to"].includes(key))), "snapshot refresh keys must never leave the browser")
      assert.deepEqual(blocked, [])
      assert.deepEqual(errors, [])
    })
  }
  console.log(`Maintenance browser verification: ${passed.length} scenarios passed (390x844, 1366x768, 1280x720, 320x568 at 100% zoom). Local fixtures only.`)
  if (warnings.length) console.log(`Non-fatal existing React ref warnings: ${warnings.length}; recorded in results.json.`)
} catch (error) {
  failure = { ...current, message: error.message }
  console.error(`FAIL ${current?.width}px: ${current?.name}: ${error.message}`)
  await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {})
  throw error
} finally {
  await writeFile(join(output, "results.json"), JSON.stringify({ status: failure ? "failed" : "passed", passed, count: passed.length, failure, errors, warnings, blocked, scope: "Actual AdminBookings and BookingProvider; simulated in-memory services only, not API persistence/concurrency." }, null, 2))
  console.log(`Maintenance browser artifacts: ${output}`)
  await browser?.close()
  await server.close()
}
