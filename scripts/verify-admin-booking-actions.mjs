/**
 * Local-only Chromium coverage for the authorized Admin Booking Management
 * modification/cancellation actions. The real admin page, details modal,
 * modification dialog, and cancellation confirmation are rendered; Firestore,
 * auth, catalog, and action persistence are deterministic local fixtures.
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
const output = await mkdtemp(join(process.env.ADMIN_BOOKING_ACTIONS_TEMP_DIR || tmpdir(), "one-estela-admin-booking-actions-"))

const modules = {
  state: `
    import {useSyncExternalStore} from 'react';
    import {buildAdminCancellationFields} from '@/src/modules/shared/lib/cancellation';
    const params=new URLSearchParams(location.search);
    const role=params.get('role')||'admin';
    const booking={id:'ADMIN-BOOKING-1',userId:'CLIENT-1',venueId:'VENUE-1',spaceId:'VENUE-1',officeId:'',bookingCategory:'venue',bookingType:'venue',isOfficeRental:false,
      venue:'Fixture Hall',eventName:'Client Planning Session',eventType:'Corporate Event',guestCount:60,date:'2099-03-01',endDate:'',startTime:'08:00',endTime:'14:00',time:'08:00 - 14:00',specialRequests:'Existing access requirements',
      createdAt:'2026-11-01T04:00:00Z',totalPrice:10000,amountPaid:10000,paymentStatus:'paid',isSlotSecured:true,verifiedByAdmin:true,status:'confirmed',bookingStatus:'Confirmed',
      contractStatus:'Signed',contractSigned:true,userInfo:{name:'Fixture Client',email:'client@example.test',phone:'09170000000'},cancellationStatus:'None',cancellationRequested:false,refundStatus:'Not Applicable'};
    let state={bookings:[booking],paymentRecords:[],maintenanceRecords:[],officeRentals:[],isLoading:false,dataError:null,dataErrors:{}};
    const listeners=new Set();
    const publish=patch=>{state={...state,...patch};listeners.forEach(fn=>fn())};
    const patchBooking=patch=>publish({bookings:[{...state.bookings[0],...patch}]});
    const actions={
      getUserBookings:()=>state.bookings,
      getBookingById:id=>state.bookings.find(item=>item.id===id),
      modifyBooking:async(id,updates)=>{
        const allowed=['date','eventName','startTime','endTime'];
        const patch=Object.fromEntries(allowed.filter(key=>updates[key]!==undefined).map(key=>[key,updates[key]]));
        window.fixture.modifications.push({id,patch});
        const previous=state.bookings[0];
        const scheduleChanged=patch.date!==undefined||patch.startTime!==undefined||patch.endTime!==undefined;
        const current={date:previous.date,startTime:previous.startTime,endTime:previous.endTime};
        const next={...current,...patch};
        const history=previous.scheduleHistory||[];
        const scheduleFields=scheduleChanged&&!previous.originalSchedule?{originalSchedule:current}:{};
        const historyFields=scheduleChanged?{...scheduleFields,scheduleHistory:[...history,{revision:history.length+1,previousSchedule:current,currentSchedule:next,changedAt:'2099-01-01T00:00:00.000Z'}]}:{};
        patchBooking({...patch,...historyFields}); return {...previous,...patch,...historyFields};
      },
      adminCancelBooking:async(id,reason)=>{
        window.fixture.adminCancellations.push({id,reason});
        const fields=buildAdminCancellationFields(state.bookings[0],reason,'2099-01-01T00:00:00.000Z',{id:'ADMIN-1',name:'Fixture Admin'},[]);
        patchBooking(fields); return {...state.bookings[0],...fields};
      },
      updateBookingStatus:async()=>state.bookings[0],
      markContractSigned:async()=>state.bookings[0],
      approveCancellation:async()=>state.bookings[0],
      declineCancellation:async()=>state.bookings[0],
      approveModification:async()=>state.bookings[0],
      declineModification:async()=>state.bookings[0],
      markAsRefunded:async()=>state.bookings[0],
      sendBalanceReminder:async()=>state.bookings[0],
      manualRecordOnsitePayment:async()=>state.bookings[0],
      retryData:()=>{},
    };
    const user={id:role==='admin'?'ADMIN-1':role==='staff'?'STAFF-1':'CLIENT-1',role,permissions:role==='staff'?{bookings:true}: {},fullName:'Fixture Admin'};
    window.fixture={snapshot:()=>state.bookings[0],patchBooking,modifications:[],adminCancellations:[],navigation:[]};
    export function useBookingData(){const snapshot=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>state);return {...snapshot,...actions};}
    export const useBookings=useBookingData;
    export const fixtureUser=user;
    export const notifications={markByBookingId:async()=>{}};
    export const toast=()=>{};
    const nativeFetch=window.fetch.bind(window);const availabilitySlots=[{startMinutes:480,endMinutes:840,startTimeLabel:'8:00 AM',endTimeLabel:'2:00 PM',label:'8:00 AM - 2:00 PM'},{startMinutes:540,endMinutes:900,startTimeLabel:'9:00 AM',endTimeLabel:'3:00 PM',label:'9:00 AM - 3:00 PM'},{startMinutes:600,endMinutes:960,startTimeLabel:'10:00 AM',endTimeLabel:'4:00 PM',label:'10:00 AM - 4:00 PM'}];
    const availabilityResponse=(url)=>{const from=url.searchParams.get('from')||'2099-03-01',to=url.searchParams.get('to')||from,dates={};for(let day=new Date(from+'T00:00:00Z');day<=new Date(to+'T00:00:00Z');day.setUTCDate(day.getUTCDate()+1)){const key=day.toISOString().slice(0,10);dates[key]={status:'available',availableSlots:availabilitySlots,occupiedIntervals:[]};}return new Response(JSON.stringify({space:{category:url.searchParams.get('category')==='office'?'office':'venue',venueId:url.searchParams.get('venueId'),officeId:url.searchParams.get('officeId')||undefined,spaceId:url.searchParams.get('spaceId')||url.searchParams.get('venueId')},dates}),{status:200,headers:{'content-type':'application/json'}})};
    window.fetch=(input,options)=>{const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.pathname==='/api/availability')return Promise.resolve(availabilityResponse(url));if(url.pathname.startsWith('/api/')||url.origin!==location.origin)throw Error('Unexpected live request');return nativeFetch(input,options)};
  `,
  booking: `export {useBookingData,useBookings} from 'virtual:admin-actions-state';`,
  auth: `import {fixtureUser} from 'virtual:admin-actions-state';export const useAuth=()=>({user:fixtureUser,isLoading:false});`,
  notifications: `import {notifications} from 'virtual:admin-actions-state';export const useNotifications=()=>notifications;`,
  cms: `const cmsData={venues:[{id:'VENUE-1',name:'Fixture Hall',price:10000,capacity:'60'}],offices:[{id:'OFFICE',name:'Fixture Office',rooms:[{id:'ROOM',name:'Room 1'}]}],officeRentalContract:null,eventVenueContract:null};export const useCMS=()=>({cmsData,offices:cmsData.offices,getOfficeRooms:()=>cmsData.offices[0].rooms});`,
  toast: `import {toast} from 'virtual:admin-actions-state';export const useToast=()=>({toast});`,
  navigation: `const params=new URLSearchParams(location.search);export const useRouter=()=>({push:url=>window.fixture.navigation.push(url),replace:()=>{}});export const useSearchParams=()=>params;`,
  firebase: `export const db={};`,
  token: `export const getAuthScope=async()=> 'LOCAL-ADMIN-ACTIONS';export const getAuthHeaders=async()=>({'Content-Type':'application/json'});`,
  firestore: `export const collection=()=>({}),query=ref=>ref,where=()=>({}),orderBy=()=>({}),limit=()=>({}),doc=()=>({}),getDoc=async()=>({exists:()=>false}),getDocs=async()=>({docs:[],forEach(){}}),addDoc=async()=>({id:'LOCAL'});`,
  entry: `import React from 'react';import {createRoot} from 'react-dom/client';import Admin from '@/app/(admin)/dashboard/bookings/page';import '@/app/globals.css';import 'virtual:admin-actions-state';createRoot(document.getElementById('root')).render(React.createElement(Admin));`,
}

const mocks = [
  [/\/client\/contexts\/booking-context(?:\.tsx)?$/, "booking"],
  [/\/auth\/auth-context(?:\.tsx)?$/, "auth"],
  [/\/contexts\/notification-context(?:\.tsx)?$/, "notifications"],
  [/\/admin\/contexts\/cms-context(?:\.tsx)?$/, "cms"],
  [/\/hooks\/use-toast(?:\.tsx?)?$/, "toast"],
  [/^next\/navigation$/, "navigation"],
  [/\/lib\/firebase(?:\.ts)?$/, "firebase"],
  [/(?:\/lib\/|^\.\/)auth-token(?:\.ts)?$/, "token"],
  [/^firebase\/firestore$/, "firestore"],
]

const server = await createServer({
  configFile: false,
  envFile: false,
  envDir: false,
  root,
  cacheDir: join(output, "vite-cache"),
  logLevel: "silent",
  define: { "process.env.NEXT_PUBLIC_PERF_TRACE": JSON.stringify("0") },
  server: { host: "127.0.0.1", port: 0 },
  resolve: { alias: { "@": root, "@shared": join(root, "src/modules/shared") } },
  oxc: { jsx: { runtime: "automatic" } },
  css: { postcss: { plugins: [tailwindcss({ config: join(root, "tailwind.config.ts") })] } },
  optimizeDeps: {
    noDiscovery: true,
    include: [
      "react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react", "clsx", "tailwind-merge", "class-variance-authority",
      "@radix-ui/react-dialog", "@radix-ui/react-visually-hidden", "@radix-ui/react-select", "@radix-ui/react-collapsible", "@radix-ui/react-slot", "@radix-ui/react-label", "@radix-ui/react-checkbox", "@radix-ui/react-progress", "@radix-ui/react-tooltip", "@radix-ui/react-tabs", "@radix-ui/react-popover", "@radix-ui/react-calendar",
    ],
  },
  plugins: [{
    name: "local-admin-booking-actions",
    enforce: "pre",
    resolveId(source) {
      if (source.startsWith("virtual:admin-actions-")) return `\0admin-actions-${source.slice("virtual:admin-actions-".length)}.tsx`
      const mock = mocks.find(([pattern]) => pattern.test(source.replaceAll("\\", "/")))
      return mock ? `\0admin-actions-${mock[1]}.tsx` : undefined
    },
    load(id) { return modules[id.match(/^\0admin-actions-(.+)\.tsx$/)?.[1]] },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/__admin-booking-actions")) return next()
        response.setHeader("Content-Type", "text/html")
        response.end(await vite.transformIndexHtml(request.url, '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--font-sans:Arial,sans-serif}body{min-height:100vh;background:#f8fafc}</style></head><body><main><div id="root"></div></main><script type="module" src="/@id/__x00__admin-actions-entry.tsx"></script></body></html>'))
      })
    },
  }],
})

let browser
let page
const passed = []
const errors = []
let current = "setup"

try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true, channel: process.env.ADMIN_BOOKING_ACTIONS_BROWSER_CHANNEL || undefined })
  const context = await browser.newContext({ locale: "en-US", timezoneId: "Asia/Manila", deviceScaleFactor: 1, hasTouch: true, serviceWorkers: "block" })
  await context.route("**/*", route => {
    const url = new URL(route.request().url())
    return url.origin === origin || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort()
  })
  page = await context.newPage()
  page.on("pageerror", error => errors.push(error.message))
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()) })

  const adminModal = () => page.getByRole("dialog").filter({ has: page.getByRole("region", { name: "Booking details content", exact: true }) })
  const modifyModal = () => page.getByRole("dialog").filter({ has: page.getByRole("tab", { name: "Event Details", exact: true }) })
  const openDetails = async (role = "admin") => {
    await page.goto(`${origin}/__admin-booking-actions?role=${role}`)
    await page.getByRole("button", { name: "View Details", exact: true }).click()
    await adminModal().waitFor()
  }
  const closeDetails = async () => {
    await adminModal().getByRole("button", { name: "Close booking details", exact: true }).click()
    await page.waitForFunction(() => !document.body.hasAttribute("data-scroll-locked"))
  }
  const assertDialogFits = async label => {
    const dialog = adminModal()
    const box = await dialog.boundingBox()
    const viewport = page.viewportSize()
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${label}: details dialog fits viewport`)
    assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false, `${label}: details dialog has no horizontal overflow`)
  }

  const assertActionGrid = async () => {
    const dialog = adminModal(), body = dialog.getByRole('region', { name: 'Booking details content', exact: true })
    const footer = dialog.locator('footer'), grid = footer.locator(':scope > div')
    const columns = page.viewportSize().width >= 640 ? 2 : 1
    assert.equal(await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), columns)
    const boxes = await footer.getByRole('button').evaluateAll(nodes => nodes.map(el => {
      const r = el.getBoundingClientRect(); return { contract:el.hasAttribute('data-contract-action'), x:r.x, y:r.y, width:r.width, height:r.height, overflow:el.scrollWidth > el.clientWidth + 1 }
    }))
    assert.ok(boxes.length >= 5, 'exercise the crowded five-action state, not just two controls')
    const gridBox = await grid.boundingBox()
    const contract = boxes.find(box => box.contract)
    assert.ok(contract && gridBox && Math.abs(contract.width - gridBox.width) < 1, 'contract action spans the full action grid')
    const ordinary = boxes.filter(box => !box.contract)
    const ordinaryWidth = gridBox ? (columns === 1 ? gridBox.width : (gridBox.width - 8) / 2) : 0
    for (const [index, box] of ordinary.entries()) {
      assert.equal(box.height, 44)
      assert.equal(box.overflow, false)
      assert.ok(Math.abs(box.width - ordinaryWidth) < 1, 'ordinary actions retain two-column width')
      if (index >= columns) assert.ok(Math.abs(box.y - ordinary[index-columns].y - 52) < 1, '44px buttons with 8px row gaps')
    }
    const shortPhone = page.viewportSize().width < 640 && page.viewportSize().height <= 680
    const scroller = shortPhone ? dialog.locator('[data-admin-booking-scroll]') : body
    const header = await dialog.locator('header').boundingBox(), footerBox = await footer.boundingBox()
    assert.ok((await scroller.boundingBox()).height >= 100, 'details retain a useful content region')
    assert.equal(await dialog.evaluate(el => [el, ...el.querySelectorAll('*')].filter(node => ['auto','scroll'].includes(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1).length), 1)
    await scroller.evaluate(el => {el.scrollTop = el.scrollHeight})
    assert.deepEqual(await dialog.locator('header').boundingBox(), header)
    if (!shortPhone) assert.deepEqual(await footer.boundingBox(), footerBox)
    const reachableFooter = await footer.boundingBox()
    assert.ok(reachableFooter.y + reachableFooter.height <= page.viewportSize().height, 'last actions reachable without obscuring details')
    await footer.getByRole('button', { name:'Modify Booking', exact:true }).focus()
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow), 'none')
  }

  const assertModifyFits = async dialog => {
    const box = await dialog.boundingBox(), viewport = page.viewportSize()
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1)
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false)
    const footer = await dialog.locator('[data-slot="dialog-footer"]').boundingBox()
    assert.ok(footer.y + footer.height <= box.y + box.height + 1)
    for (const control of await dialog.locator('input,textarea,[role="combobox"],[role="tablist"],[data-slot="calendar"]').all()) {
      const r = await control.boundingBox()
      if (r) assert.ok(r.x >= box.x + 15 && r.x + r.width <= box.x + box.width - 15, 'form controls retain safe horizontal gutters')
      if (r && await control.evaluate(el => el.matches('input,[role="combobox"]'))) assert.equal(r.height,44,'consistent input and selector heights')
      assert.equal(await control.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, 'no clipped form controls')
    }
    const tabs = await dialog.getByRole('tab').all()
    assert.ok(Math.abs((await tabs[0].boundingBox()).width - (await tabs[1].boundingBox()).width) < 1)
  }

  for (const width of [320, 375, 768, 1024, 1280, 1366, 1440]) {
    current = `responsive details at ${width}px`
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 })
    await openDetails()
    await page.evaluate(() => window.fixture.patchBooking({amountPaid:5000,paymentStatus:'partial',contractSigned:false,contractStatus:'Pending'}))
    await adminModal().getByRole('button', { name:'Send Balance Reminder', exact:true }).waitFor()
    await assertDialogFits(current)
    assert.equal(await adminModal().getByRole("button", { name: "Modify Booking", exact: true }).count(), 1)
    assert.equal(await adminModal().getByRole("button", { name: "Cancel Booking", exact: true }).count(), 1)
    await assertActionGrid()
    await page.screenshot({path:join(output, `${width}-details-grid.png`)})
    await adminModal().getByRole('button', { name:'Modify Booking', exact:true }).click()
    const modify = modifyModal()
    await modify.waitFor()
    await assertModifyFits(modify)
    await modify.getByLabel('Event Name', {exact:true}).fill('Editable temporary title')
    await modify.getByRole('tab', {name:'Date & Time',exact:true}).click()
    await assertModifyFits(modify)
    assert.match(await modify.getByRole('combobox',{name:'Start Time',exact:true}).innerText(),/8:00 AM/,'retain the stored time label on unrelated edits')
    assert.match(await modify.getByRole('combobox',{name:'End Time',exact:true}).innerText(),/2:00 PM/)
    const calendarDay=modify.locator('button[data-day="3/2/2099"]')
    await calendarDay.click()
    assert.equal(await calendarDay.getAttribute('data-selected-single'),'true')
    await modify.getByRole('combobox',{name:'Start Time',exact:true}).click()
    await page.getByRole('option',{name:'9:00 AM',exact:true}).click()
    assert.match(await modify.getByRole('combobox',{name:'Start Time',exact:true}).innerText(),/9:00 AM/)
    await page.screenshot({path:join(output, `${width}-modify-date-time.png`)})
    assert.equal(await modify.getByRole('tabpanel').count(), 1)
    await modify.getByRole('tab', {name:'Event Details',exact:true}).focus()
    await page.keyboard.press('ArrowRight')
    await modify.locator('[role="tab"][aria-selected="true"]').filter({hasText:'Date & Time'}).waitFor()
    assert.equal(await modify.getByRole('tab', {name:'Date & Time',exact:true}).getAttribute('aria-selected'), 'true')
    await modify.getByRole('tab', {name:'Event Details',exact:true}).click()
    assert.equal(await modify.getByLabel('Event Name', {exact:true}).inputValue(), 'Editable temporary title')
    if (width < 640) await modify.getByRole('button', {name:'Cancel',exact:true}).tap()
    else await modify.getByRole('button', {name:'Cancel',exact:true}).click()
    await modify.waitFor({state:'detached'})
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'View Details')
    assert.deepEqual(await page.evaluate(() => window.fixture.modifications), [])
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.getByRole('button', {name:'View Details',exact:true}).click()
    await adminModal().getByRole('button', {name:'Modify Booking',exact:true}).click()
    await modify.waitFor()
    await page.keyboard.press('Escape')
    await modify.waitFor({state:'detached'})
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'View Details')
    await page.waitForFunction(() => !document.body.hasAttribute('data-scroll-locked'))
    await page.screenshot({path:join(output, `${width}-booking-actions.png`)})
    passed.push(current)
    console.log(`PASS ${current}`)
  }

  current = "admin modifies supported fields and rejects invalid capacity"
  await page.setViewportSize({ width: 1440, height: 844 })
  await openDetails()
  await adminModal().getByRole("button", { name: "Modify Booking", exact: true }).click()
  const modifyDialog = modifyModal()
  await modifyDialog.waitFor()
  assert.equal(await modifyDialog.getByLabel("Expected Guests", { exact: true }).count(), 0)
  assert.equal(await modifyDialog.getByLabel("Special Requests", { exact: true }).count(), 0)
  assert.equal(await modifyDialog.getByLabel("Venue", { exact: true }).count(), 0)
  await modifyDialog.getByLabel("Event Name", { exact: true }).fill("Admin Updated Planning Session")
  await modifyDialog.getByRole("button", { name: "Continue", exact: true }).click()
  await modifyDialog.getByRole("button", { name: "Save Changes", exact: true }).click()
  await adminModal().waitFor()
  await adminModal().getByRole("heading", { name: "Admin Updated Planning Session", exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.fixture.modifications.map(item => item.patch.eventName)), ["Admin Updated Planning Session"])
  passed.push(current)
  console.log(`PASS ${current}`)

  current = "admin cancellation confirmation keep and confirm flows"
  await adminModal().getByRole("button", { name: "Cancel Booking", exact: true }).click()
  let cancelDialog = page.getByRole("dialog", { name: "Cancel Booking?", exact: true })
  await cancelDialog.waitFor()
  await cancelDialog.getByLabel("Cancellation reason *", { exact: true }).fill("Client schedule was cancelled by operations.")
  await cancelDialog.getByRole("button", { name: "Keep Booking", exact: true }).click()
  await cancelDialog.waitFor({ state: "detached" })
  assert.equal(await adminModal().getByRole("button", { name: "Cancel Booking", exact: true }).count(), 1)
  assert.deepEqual(await page.evaluate(() => window.fixture.adminCancellations), [])

  await adminModal().getByRole("button", { name: "Cancel Booking", exact: true }).click()
  cancelDialog = page.getByRole("dialog", { name: "Cancel Booking?", exact: true })
  await cancelDialog.getByLabel("Cancellation reason *", { exact: true }).fill("Client schedule was cancelled by operations.")
  await cancelDialog.getByRole("button", { name: "Confirm Cancellation", exact: true }).click()
  await adminModal().getByText("Cancelled", { exact: true }).first().waitFor()
  assert.deepEqual(await page.evaluate(() => window.fixture.adminCancellations), [{ id: "ADMIN-BOOKING-1", reason: "Client schedule was cancelled by operations." }])
  assert.equal(await adminModal().getByRole("button", { name: "Cancel Booking", exact: true }).count(), 0)
  assert.equal(await adminModal().getByRole("button", { name: "Modify Booking", exact: true }).count(), 0)
  await closeDetails()
  await page.getByRole("button", { name: "View Details", exact: true }).click()
  await adminModal().waitFor()
  assert.equal(await adminModal().getByRole("button", { name: "Cancel Booking", exact: true }).count(), 0)
  await closeDetails()
  passed.push(current)
  console.log(`PASS ${current}`)

  current = "staff and client cannot see direct admin cancellation"
  await openDetails("staff")
  assert.equal(await adminModal().getByRole("button", { name: "Cancel Booking", exact: true }).count(), 0)
  assert.equal(await adminModal().getByRole("button", { name: "Modify Booking", exact: true }).count(), 1)
  await closeDetails()
  await openDetails("client")
  assert.equal(await adminModal().getByRole("button", { name: "Cancel Booking", exact: true }).count(), 0)
  assert.equal(await adminModal().getByRole("button", { name: "Modify Booking", exact: true }).count(), 0)
  await closeDetails()
  passed.push(current)
  console.log(`PASS ${current}`)

  for (const width of [320,375,768,1024,1280,1366,1440]) {
    current=`responsive office modification at ${width}px`
    await page.setViewportSize({width,height:width===320?568:844})
    await openDetails()
    await page.evaluate(()=>window.fixture.patchBooking({bookingCategory:'office',bookingType:'office',isOfficeRental:true,officeId:'OFFICE',spaceId:'ROOM',guestCount:1,companyName:'Fixture Company',natureOfBusiness:'Services',officeRentalTerm:'6_months',endDate:'2099-08-31'}))
    await adminModal().getByText('Company Name',{exact:true}).waitFor()
    await adminModal().getByRole('button',{name:'Modify Booking',exact:true}).click()
    const modify=modifyModal()
    await modify.getByRole('tab',{name:'Event Details',exact:true}).waitFor()
    await assertModifyFits(modify)
    assert.equal(await modify.getByLabel('Company / Tenant Name',{exact:true}).count(), 0)
    assert.equal(await modify.getByRole('combobox',{name:'Rental Term',exact:true}).count(), 0)
    await modify.getByRole('tab',{name:'Date & Time',exact:true}).click()
    await assertModifyFits(modify)
    await modify.getByRole('button',{name:'Back',exact:true}).click()
    await modify.getByRole('button',{name:'Cancel',exact:true}).click()
    await modify.waitFor({state:'detached'})
    await page.waitForFunction(()=>document.activeElement?.textContent?.trim()==='View Details')
    passed.push(current)
    console.log(`PASS ${current}`)
  }

  assert.deepEqual(errors, [])
  console.log(`Admin booking action browser checks passed (${passed.length} scenarios). Local fixtures only. Artifacts: ${output}`)
} catch (error) {
  await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {})
  throw error
} finally {
  await writeFile(join(output, "results.json"), JSON.stringify({ passed, current, errors, scope: "Real Admin Booking Management page and Radix dialogs; local fixtures only." }, null, 2))
  await browser?.close()
  await server.close()
}
