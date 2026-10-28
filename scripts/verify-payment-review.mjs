/**
 * Chromium regression checks against the real admin/client page components.
 * Only service/provider boundaries are replaced with local in-memory fixtures.
 * No Next route, credentials, remote services, or production writes are used.
 * Uses Playwright and Vite (already installed through Vitest).
 */
import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"
import tailwindcss from "tailwindcss"
import { chromium } from "playwright"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const output = await mkdtemp(join(process.env.PAYMENT_REVIEW_TEMP_DIR || tmpdir(), "one-estela-payment-review-"))
console.log(`Payment review browser artifacts: ${output}`)
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY4sAAAAASUVORK5CYII="

const stateModule = `
  import { useSyncExternalStore } from 'react';
  import {buildFinalizedPaymentSnapshot} from '@/src/modules/shared/lib/payment-calculations';
   import {calculateAvailabilityRange,findEarliestOfficeStartDate,getOfficeRentalEndDate,getOfficeRoomStatus} from '@/src/modules/shared/lib/availability';
  const noop = () => {};
  const date = (n) => '2026-10-' + String(n).padStart(2, '0') + 'T10:00:00.000Z';
  const base = {
    userId: 'CLIENT', eventName: 'Review regression', eventType: 'Celebration', venue: 'The Milestone Event',
    venueId:'v1',spaceId:'v1',bookingCategory:'venue',
    totalPrice: 10000, totalAmount: 10000, paymentType: 'downpayment', selectedDownpaymentAmount: 5000,
    downPaymentPercentage: 50, status: 'confirmed', paymentStatus: 'partial', isSlotSecured: true,
    paymentMethod: 'bank', date: '2027-02-01', startTime: '08:00', endTime: '14:00',
    createdAt: date(1), userInfo: {name: 'Fixture Client', email: 'fixture@example.test', phone: '09000000000'},
    incompletePaymentNote: 'Payment 1 was short.', incompletePaymentReason: 'Payment 1 was short.',
    paymentRejectedReason: 'Payment 2 proof was unreadable.',
  };
  const records = [
    {id:'PAY-1', status:'Incomplete', amount:1500, amountReceived:1500, requestedAmount:5000, adminNote:'Payment 1 was short.'},
    {id:'PAY-2', status:'Rejected', amount:3500, rejectionReason:'Payment 2 proof was unreadable.'},
    {id:'PAY-3', status:'Verified', amount:1000, adminNote:'', rejectionReason:'Obsolete rejection reason'},
  ].map((record, i) => ({
    ...record, bookingId:'BK-REVIEW', customerId:'CLIENT', customerName:'Fixture Client',
    paymentNumber:i+1, term:'Down Payment', paymentMethod:'bank', submittedAt:date(i+10),
    proofUrl:${JSON.stringify(image)}, fileName:'payment-proof.png', receiptNumber:'ER-' + (i+1),
  }));
  const receipts = records.map(record => ({
    paymentId:record.id, bookingId:record.bookingId, receiptNumber:record.receiptNumber,
    paymentNumber:record.paymentNumber,
    paymentStatus:record.status, amountPaid:record.amount, paymentAmount:record.amount,
    paymentSubmittedAt:record.submittedAt, dateGenerated:record.submittedAt, paymentMethod:'Bank Transfer',
    adminNote:'Stale receipt note must not override the payment',
    totalBookingAmount:10000, requiredDpAmount:5000,
    acceptedTotalPaid:record.id==='PAY-3'?2500:1500, acceptedDpPaid:record.id==='PAY-3'?2500:1500,
    remainingDpBalance:record.id==='PAY-3'?2500:3500, remainingBalance:record.id==='PAY-3'?7500:8500,
  }));
  let state = {
    bookings:[{...base, id:'BK-REVIEW', paymentReceipts:receipts, receipt:receipts[2]}, {...base, id:'BK-OTHER', eventName:'Other booking'}],
    paymentRecords:[...records, {id:'PAY-OTHER', bookingId:'BK-OTHER', amount:5000, status:'For Verification', paymentMethod:'cash', submittedAt:date(2), term:'Down Payment'}],
    maintenanceRecords:[], officeRentals:[],
    isLoading:false, cancelBooking:async()=>null,
    addBooking:async payload=>{window.scheduleFixture.submissions.push(payload);return 'BK-NEW'},
    getUserBookings:id=>state.bookings.filter(booking=>booking.userId===id),
    requestModification:async(id,changes,reason)=>{window.modificationFixture.submissions.push({id,changes,reason});return state.bookings.find(booking=>booking.id===id)},
  };
  const listeners = new Set();
  const publish = next => {state=next; listeners.forEach(fn=>fn());};
  export function useBookingData() {return useSyncExternalStore(fn=>{listeners.add(fn); return ()=>listeners.delete(fn)},()=>state)}
  window.paymentFixture = {
    patch(id, patch) {publish({...state,paymentRecords:state.paymentRecords.map(r=>r.id===id?{...r,...patch}:r)})},
    reorder() {publish({...state,paymentRecords:[...state.paymentRecords].reverse()})},
    add() {publish({...state,paymentRecords:[{...records[2],id:'PAY-4',receiptNumber:'ER-4',paymentNumber:4,status:'For Verification',submittedAt:date(20),adminNote:''},...state.paymentRecords]})},
    remove(id) {publish({...state,paymentRecords:state.paymentRecords.filter(r=>r.id!==id),bookings:state.bookings.map(b=>({...b,paymentReceipts:b.paymentReceipts?.filter(r=>r.paymentId!==id)}))})},
    freezeHistory() {publish({...state,paymentRecords:state.paymentRecords.map(record=>record.bookingId==='BK-REVIEW'?{...record,reviewSnapshot:buildFinalizedPaymentSnapshot({...base,id:'BK-REVIEW'},records.filter(r=>r.paymentNumber<=record.paymentNumber),record,date(record.paymentNumber+10))}:record)})},
    page(ids) {publish({...state,paymentRecords:state.paymentRecords.filter(r=>ids.includes(r.id))})},
    snapshot() {return state},
    addOfficeBooking() {publish({...state,bookings:[...state.bookings,{...base,id:'ACTIVE-OFFICE',bookingCategory:'office',isOfficeRental:true,venueId:'wing-b',officeId:'wing-b',spaceId:'other-suite',venue:'South Wing - Other Suite',status:'active_rental'}]})},
  };
  let cmsState={paymentInfo:{},cmsData:{
    venues:[
      {id:'v1',name:'The Milestone Event',price:10000,capacity:'100',description:'Fixture venue',image:${JSON.stringify(image)}},
      {id:'v2',name:'Garden Pavilion',price:5000,capacity:'30',description:'Another venue',image:${JSON.stringify(image)}},
    ],
    offices:[
      {id:'wing-a',name:'North Wing',price:15000,capacity:'4',description:'Private suites',image:${JSON.stringify(image)},rooms:[{id:'quartz',name:'Quartz Suite'},{id:'harbor',name:'Harbor Suite'}]},
      {id:'wing-b',name:'South Wing',price:18000,capacity:'4',description:'Another building',image:${JSON.stringify(image)},rooms:[{id:'quartz',name:'Quartz Suite'},{id:'other-suite',name:'Other Suite'}]},
    ],
  }};
  const cmsListeners=new Set();
  export function useCMS(){return useSyncExternalStore(fn=>{cmsListeners.add(fn);return()=>cmsListeners.delete(fn)},()=>cmsState)}
  window.catalogFixture={snapshot:()=>cmsState.cmsData,patch(patch){cmsState={...cmsState,cmsData:{...cmsState.cmsData,...patch}};cmsListeners.forEach(fn=>fn())}};
  export const user = {id:'CLIENT',role:location.search.includes('admin')?'admin':'client',name:'Fixture Reviewer'};
  export const notifications = {markByBookingId:noop};
  export const router = {replace:noop,push:noop};
  export const toast = noop;
  let scheduleBlocked=false;
  const minimumDate=new Date(); minimumDate.setMonth(minimumDate.getMonth()+1);
  if(minimumDate.getDate()>25)minimumDate.setMonth(minimumDate.getMonth()+1,1);
  const dateOnly=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  const emptyDate=new Date(minimumDate);emptyDate.setDate(emptyDate.getDate()+1);
  export const calculateOfficeEndDate=getOfficeRentalEndDate;
  const modificationDate=new Date(minimumDate);modificationDate.setMonth(modificationDate.getMonth()+4,15);
  window.modificationFixture={date:dateOnly(modificationDate),submissions:[],setup(patch){
    this.submissions=[];
    publish({...state,bookings:[{...base,id:'BK-MODIFY',eventName:'Modification fixture',guestCount:25,date:this.date,time:'08:00 - 14:00',...patch}],paymentRecords:[]});
  }};
  const scheduleRequests=[],pending=[];
  let deferNext=false,failNext=false,aborted=0;
  window.scheduleFixture={date:dateOnly(minimumDate),emptyDate:dateOnly(emptyDate),submissions:[],
    block(){scheduleBlocked=true;window.dispatchEvent(new Event('focus'))},
    defer(){deferNext=true},fail(){failNext=true;window.dispatchEvent(new Event('focus'))},
    release(){pending.splice(0).forEach(resolve=>resolve())},stats(){return {requests:scheduleRequests,pending:pending.length,aborted}},
  };
   export async function getFixtureAvailability(request,signal) {
    scheduleRequests.push({...request});
    if(failNext){failNext=false;throw new Error('Fixture availability could not be loaded.')}
    const lastDate=dateOnly(new Date(minimumDate.getFullYear(),minimumDate.getMonth()+1,0));
    const event=(id,patch)=>({id,venueId:'v1',spaceId:'v1',bookingCategory:'venue',status:'confirmed',date:dateOnly(minimumDate),...patch});
    const bookings=[
      event('EXISTING-LATE',{startTime:scheduleBlocked?'12:00':'10:00',endTime:scheduleBlocked?'18:00':'14:00',eventName:'Private booking title',userInfo:{name:'Private customer'}}),
      event('EXISTING-EARLY',{startTime:'08:00',endTime:'10:00'}),
      event('UNRELATED-PRIVATE',{venueId:'v2',spaceId:'v2',startTime:'06:00',endTime:'07:00',eventName:'Unrelated event'}),
      event('CANCELLED-PRIVATE',{status:'cancelled',startTime:'14:00',endTime:'15:00'}),
      event('FULL-DAY',{date:lastDate,startTime:'12:00',endTime:'18:00'}),
    ];
    const futureDate=new Date(minimumDate);futureDate.setMonth(futureDate.getMonth()+9);
    const maintenance=[{id:'FUTURE-MAINTENANCE',type:'office',officeId:'wing-a',spaceId:'quartz',status:'active',date:dateOnly(futureDate),endDate:dateOnly(futureDate)}];
    const space={...request,catalog:cmsState.cmsData};
    const scopedBookings=[...bookings,...(location.search.includes('bookings')?state.bookings:[])].filter(booking=>booking.id!==request.excludeBookingId);
    const dates=calculateAvailabilityRange(space,request.from,request.to,scopedBookings,maintenance,[],undefined,request.rentalTerm);
    const response={dates,...(request.officeSearch?{officeSearch:{...request.officeSearch,
      earliestAvailableStartDate:findEarliestOfficeStartDate(space,request.officeSearch.from,request.officeSearch.to,request.rentalTerm,scopedBookings,maintenance)}}:{})};
    if(deferNext){deferNext=false;return new Promise(resolve=>{
      // Deliberately resolve aborted fixtures late to exercise the hook's stale-response guard.
      pending.push(()=>resolve(response));signal?.addEventListener('abort',()=>aborted++,{once:true});
    })}
     return response;
   }
   export async function getFixtureOfficeRooms(officeId,today) {
     const office=cmsState.cmsData.offices.find(office=>office.id===officeId);
     return Object.fromEntries((office?.rooms||[]).map(room=>[room.id,getOfficeRoomStatus(
       {category:'office',venueId:officeId,officeId,spaceId:room.id,catalog:cmsState.cmsData},today,state.bookings,[],[])]));
   }
`

const modules = {
  state: stateModule,
  booking: `export {useBookingData,useBookingData as useBookings,calculateOfficeEndDate} from 'virtual:payment-state'; export const isCancellationAllowed=()=>false,isRefundEligible=()=>false,getCancellationMessage=()=>'',canShowCancellationNotice=()=>false,canRequestCancellation=()=>false`,
  auth: `import {user} from 'virtual:payment-state'; export const useAuth=()=>({user,isLoading:false})`,
  notifications: `import {notifications} from 'virtual:payment-state'; export const useNotifications=()=>notifications`,
  cms: `export {useCMS} from 'virtual:payment-state'`,
  toast: `import {toast} from 'virtual:payment-state'; export const useToast=()=>({toast})`,
  navigation: `import {router} from 'virtual:payment-state'; const params=new URLSearchParams(); export const useRouter=()=>router; export const useSearchParams=()=>params`,
  firebase: `export const db={}`,
  firestore: `export const collection=(_,name)=>({name}); export const query=ref=>ref; export const orderBy=()=>({}); export const where=()=>({}); export const limit=()=>({}); export const doc=()=>({}); export const addDoc=async()=>({id:'FIXTURE'}); export const getDoc=async()=>({exists:()=>false}); export const getDocs=async(ref)=>({forEach(fn){if(ref.name==='reviews')for(let n=0;n<20;n++)fn({id:'REVIEW-'+n,data:()=>({venue:'The Milestone Event',customerName:'Guest '+n,rating:5,comment:'A detailed venue review. '.repeat(20),createdAt:'2026-09-01'})})}})`,
  availability: `export {getFixtureAvailability as fetchAvailability,getFixtureOfficeRooms as fetchOfficeRoomAvailability} from 'virtual:payment-state'`,
  entry: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import Admin from '@/app/(admin)/dashboard/payments/page';
    import Client from '@/app/portal/payments/page';
    import Bookings from '@/app/portal/bookings/page';
    import {ReserveDialog} from '@/src/modules/client/components/reserve-dialog';
    import '@/app/globals.css';
    import 'virtual:payment-state';
    createRoot(document.getElementById('root')).render(React.createElement(location.search.includes('reserve')?ReserveDialog:location.search.includes('bookings')?Bookings:location.search.includes('admin')?Admin:Client));
  `,
}

const mocks = [
  [/\/client\/contexts\/booking-context(?:\.tsx)?$/, "booking"],
  [/\/auth\/auth-context(?:\.tsx)?$/, "auth"],
  [/\/contexts\/notification-context(?:\.tsx)?$/, "notifications"],
  [/\/admin\/contexts\/cms-context(?:\.tsx)?$/, "cms"],
  [/\/hooks\/use-toast(?:\.tsx?)?$/, "toast"],
  [/^next\/navigation$/, "navigation"],
  [/\/lib\/firebase(?:\.ts)?$/, "firebase"],
  [/^firebase\/firestore$/, "firestore"],
  [/\/lib\/availability-client(?:\.ts)?$/, "availability"],
]

const server = await createServer({
  configFile: false,
  root,
  cacheDir: join(output, "vite-cache"),
  logLevel: "error",
  define: { "process.env.NEXT_PUBLIC_PERF_TRACE": JSON.stringify("0") },
  server: { host: "127.0.0.1", port: 0 },
  resolve: { alias: { "@": root, "@shared": join(root, "src/modules/shared") } },
  oxc: { jsx: { runtime: "automatic" } },
  css: { postcss: { plugins: [tailwindcss({ config: join(root, "tailwind.config.ts") })] } },
  optimizeDeps: { noDiscovery: true, include: [
    "react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react", "clsx", "tailwind-merge", "class-variance-authority",
    "@radix-ui/react-dialog", "@radix-ui/react-visually-hidden", "@radix-ui/react-select", "@radix-ui/react-collapsible", "@radix-ui/react-slot", "@radix-ui/react-label", "@radix-ui/react-checkbox",
    "@radix-ui/react-progress", "@radix-ui/react-tooltip", "docx-preview",
  ] },
  plugins: [{
    name: "local-payment-review-fixtures",
    enforce: "pre",
    resolveId(source) {
      if (source.startsWith("virtual:payment-")) return `\0fixture-${source.slice("virtual:payment-".length)}.tsx`
      const match = mocks.find(([pattern]) => pattern.test(source.replaceAll("\\", "/")))
      if (match) return `\0fixture-${match[1]}.tsx`
    },
    load(id) {
      const match = id.match(/^\0fixture-(.+)\.tsx$/)
      if (match) return modules[match[1]]
    },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/__payment-review")) return next()
        const html = await vite.transformIndexHtml(request.url, '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--font-sans:Montserrat,Arial,sans-serif}</style></head><body class="font-sans"><div id="root"></div><script type="module" src="/@id/__x00__fixture-entry.tsx"></script></body></html>')
        response.setHeader("Content-Type", "text/html")
        response.end(html)
      })
    },
  }],
})

let browser
let checks = 0
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true, channel: process.env.PAYMENT_REVIEW_BROWSER_CHANNEL || undefined })
  const errors = []
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
   page.on("pageerror", error => { errors.push(error.message); console.error("Browser runtime:", error.stack || error.message) })
  page.on("console", message => { if (message.type() === "error") console.error("Browser console:", message.text().split("\n")[0]) })
  await page.route("**/*", route => {
    const url = route.request().url()
    return url.startsWith(origin) || url.startsWith("data:") || url.startsWith("blob:") ? route.continue() : route.abort()
  })
  const noteCard = () => page.getByRole("region", { name: "Review Note", exact: true })
  const proofCard = () => page.getByRole("region", { name: "Payment Proof", exact: true })
  const noteIs = async expected => {
    await page.waitForFunction(text => document.querySelector('section[aria-label="Review Note"] p')?.textContent === text, expected)
    checks++
  }
  const inputIsEmpty = async locator => { assert.equal(await locator.inputValue(), ""); checks++ }
  const select = async number => {
    await page.getByRole("button", { name: new RegExp(`^Submission ${number}(?:\\D|$)`) }).click()
  }
  const open = async surface => {
    await page.goto(`${origin}/__payment-review?${surface}`)
    await page.getByRole("button", { name: surface === "admin" ? "Review" : "View Details", exact: true }).first().click()
    await noteIs("No review note for this payment.")
  }
  const layoutIs = async desktop => {
    await noteCard().scrollIntoViewIfNeeded()
    const proof = await proofCard().boundingBox()
    const note = await noteCard().boundingBox()
    assert.ok(proof && note)
    if (desktop) {
      assert.ok(Math.abs(proof.y - note.y) < 1, "cards must share a top edge")
      assert.ok(Math.abs(proof.height - note.height) < 1, "desktop card heights must match")
      assert.ok(Math.abs(proof.width - note.width) < 1, "desktop card widths must match")
    } else {
      assert.ok(note.y >= proof.y + proof.height, "mobile cards must stack")
      assert.ok(note.height < proof.height, "stacked empty note should keep its natural height")
    }
    const overflow = await page.locator('[data-slot="dialog-content"]').first().evaluate(element => element.scrollWidth > element.clientWidth + 1)
    assert.equal(overflow, false, "modal must not overflow horizontally")
    checks++
  }

  for (const surface of ["admin", "client"]) {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await open(surface)
    await layoutIs(true)
    await page.getByText("Your ₱7,500 unpaid balance includes ₱2,500 needed to complete your down payment.", {exact:true}).waitFor()
    assert.match(await page.getByText("Total Credited Payments:", {exact:true}).locator("..").textContent(), /₱2,500\.00/)
    await page.screenshot({ path: join(output, `${surface}-desktop-empty-note.png`) })
    await page.getByText("Total Unpaid Balance", {exact:true}).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(output, `${surface}-desktop-summary.png`) })
    checks += 2
    if (surface === "client") await page.getByRole("button", { name: /^Submission History/ }).click()
    for (const [number, note] of [[1, "Payment 1 was short."], [2, "Payment 2 proof was unreadable."], [3, "No review note for this payment."], [1, "Payment 1 was short."], [3, "No review note for this payment."]]) {
      await select(number)
      await noteIs(note)
    }
    await page.evaluate(() => window.paymentFixture.add())
    await page.getByRole("button", { name: /^Submission 4\D/ }).waitFor()
    await noteIs("No review note for this payment.")
    assert.equal(await page.getByRole("button", { name: /^Submission 3\D/ }).getAttribute("aria-pressed"), "true")
    await page.evaluate(() => {
      window.paymentFixture.reorder()
      window.paymentFixture.patch("PAY-1", {submittedAt: "2026-10-25T10:00:00.000Z"})
    })
    await noteIs("No review note for this payment.")
    assert.equal(await page.getByRole("button", { name: /^Submission 3\D/ }).getAttribute("aria-pressed"), "true")
    checks += 2

    await page.evaluate(() => window.paymentFixture.patch("PAY-3", { fileName: "very-long-proof-filename-".repeat(12) + ".png" }))
    await proofCard().getByRole("button", { name: /^Preview payment proof very-long/ }).waitFor()
    await layoutIs(true)
    await proofCard().getByRole("button", { name: /^Preview payment proof/ }).focus()
    await page.keyboard.press("Enter")
    await page.getByRole("button", { name: "Close payment proof preview" }).click()
    const popupPromise = page.waitForEvent("popup")
    await proofCard().getByRole("button", { name: "Open proof in new tab" }).click()
    const popup = await popupPromise
    await popup.waitForURL(/^blob:/)
    assert.equal(await popup.evaluate(() => window.opener), null)
    await popup.close()
    checks += 2

    const longNote = "A long review note with all of its details visible.\n".repeat(25) + "Unbroken".repeat(40)
    await page.evaluate(note => window.paymentFixture.patch("PAY-3", {adminNote:note}), longNote)
    await noteIs(longNote)
    await layoutIs(true)
    assert.equal(await noteCard().evaluate(element => element.scrollHeight > element.clientHeight + 1), false)
    await page.screenshot({ path: join(output, `${surface}-desktop-long-note.png`) })

    await page.evaluate(() => window.paymentFixture.patch("PAY-3", {adminNote:"Short review note."}))
    await noteIs("Short review note.")
    await noteCard().scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(output, `${surface}-desktop-short-note.png`) })
    await page.evaluate(() => window.paymentFixture.patch("PAY-3", {adminNote:"",proofUrl:""}))
    await noteIs("No review note for this payment.")
    await proofCard().getByText("No proof uploaded", { exact: true }).waitFor()
    await page.screenshot({ path: join(output, `${surface}-desktop-missing-proof.png`) })
    await page.evaluate(() => window.paymentFixture.patch("PAY-3", {proofUrl:"https://fixture.invalid/proof.pdf"}))
    await proofCard().getByText("Unsupported proof format", { exact: true }).waitFor()
    await page.evaluate(() => window.paymentFixture.patch("PAY-3", {paymentMethod:"cash"}))
    await proofCard().getByText("Cash Payment at Office", { exact: true }).waitFor()
    checks += 3

    await page.evaluate(proofUrl => window.paymentFixture.patch("PAY-3", {paymentMethod:"bank",proofUrl}), image)
    await page.setViewportSize({width:390,height:844})
    await layoutIs(false)
    await page.screenshot({ path: join(output, `${surface}-mobile-empty-note.png`) })
    await page.evaluate(note => window.paymentFixture.patch("PAY-3", {adminNote:note}), longNote)
    await noteIs(longNote)
    await noteCard().scrollIntoViewIfNeeded()
    assert.equal(await noteCard().evaluate(element => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1), false)
    await page.screenshot({ path: join(output, `${surface}-mobile-long-note.png`) })
    checks++
    await page.evaluate(() => window.paymentFixture.remove("PAY-3"))
    await page.getByRole("status").filter({hasText:"selected submission is no longer available"}).waitFor()
    checks++
  }

  // Historical snapshots render identically on both real pages even when the
  // live ledger, proof/note projection, and loaded history page subsequently change.
  for (const surface of ["admin", "client"]) {
    await page.setViewportSize({width:1440,height:1000})
    await open(surface)
    await page.evaluate(() => window.paymentFixture.freezeHistory())
    if (surface === "client") await page.getByRole("button", {name:/^Submission History/}).click()
    await select(1)
    await page.getByText("Historical Payment Summary", {exact:true}).waitFor()
    await page.waitForFunction(() => document.querySelector('.receipt-print')?.textContent.includes('₱8,500.00'))
    await page.evaluate(() => {
      window.paymentFixture.add()
      window.paymentFixture.patch('PAY-4',{status:'Verified',amount:500})
      window.paymentFixture.patch('PAY-1',{adminNote:'Unrelated update',proofUrl:'later.png',amount:9999})
      window.paymentFixture.reorder()
      window.paymentFixture.page(['PAY-1'])
    })
    await noteIs("Payment 1 was short.")
    assert.match(await page.locator('.receipt-print').textContent(), /₱8,500\.00/)
    assert.equal(await page.getByRole("button",{name:/^Submission 1\D/}).getAttribute('aria-pressed'),'true')
    await proofCard().getByRole('button',{name:/^Preview payment proof/}).click()
    assert.match(await page.getByRole('img',{name:'payment-proof.png',exact:true}).getAttribute('src'), /^data:image/)
    await page.getByRole('button',{name:'Close payment proof preview'}).click()
    checks+=3
  }

  // Exercise actual review actions and component lifetimes, not a copy of the form state.
  await page.setViewportSize({ width: 1440, height: 1000 })
  await open("admin")
  await page.evaluate(() => window.paymentFixture.patch("PAY-3", {status:"For Verification",rejectionReason:""}))
  await page.getByRole("button", {name:"Reject Payment",exact:true}).click()
  await page.getByLabel("Rejection Reason").fill("Unsaved rejection draft")
  await page.getByRole("button", {name:"Cancel",exact:true}).click()
  await page.getByRole("button", {name:"Mark as Incomplete",exact:true}).click()
  await inputIsEmpty(page.getByLabel("Admin Note / Reason *",{exact:true}))
  await page.getByLabel("Admin Note / Reason *",{exact:true}).fill("Unsaved incomplete draft")
  await page.getByRole("button", {name:"Cancel",exact:true}).click()
  await page.getByRole("button", {name:"Reject Payment",exact:true}).click()
  await inputIsEmpty(page.getByLabel("Rejection Reason"))
  await page.getByRole("button", {name:"Cancel",exact:true}).click()
  await page.getByRole("button", {name:"Close payment review"}).click()
  await page.getByRole("button", {name:"Review",exact:true}).nth(1).click()
  await page.getByRole("button", {name:"Verify Payment",exact:true}).click()
  await inputIsEmpty(page.getByLabel("Admin Note (optional)",{exact:true}))
  await page.getByLabel("Admin Note (optional)",{exact:true}).fill("Draft on another booking")
  await page.getByRole("button", {name:"Cancel",exact:true}).click()
  await page.getByRole("button", {name:"Verify Payment",exact:true}).click()
  await inputIsEmpty(page.getByLabel("Admin Note (optional)",{exact:true}))
  await page.getByRole("button", {name:"Cancel",exact:true}).click()
  await page.getByRole("button", {name:"Reject Payment",exact:true}).click()
  await inputIsEmpty(page.getByLabel("Rejection Reason"))
  await page.getByRole("button", {name:"Cancel",exact:true}).click()
  await page.getByRole("button", {name:"Close payment review"}).click()
  await page.getByRole("button", {name:"Review",exact:true}).first().click()
  await page.evaluate(() => window.paymentFixture.add())
  await select(3)
  await page.getByRole("button", {name:"Reject Payment",exact:true}).click()
  await inputIsEmpty(page.getByLabel("Rejection Reason"))
  await page.getByLabel("Rejection Reason").fill("Draft for submission 3")
  await page.getByRole("button", {name:"Cancel",exact:true}).click()
  await select(4)
  await page.getByRole("button", {name:"Reject Payment",exact:true}).click()
  await inputIsEmpty(page.getByLabel("Rejection Reason"))
  const historical = await page.evaluate(() => window.paymentFixture.snapshot())
  assert.equal(historical.bookings[0].incompletePaymentNote, "Payment 1 was short.")
  assert.equal(historical.paymentRecords.find(record => record.id === "PAY-1").adminNote, "Payment 1 was short.")

  if (!process.argv.includes("--payments-only")) {
  // Exercise the real nested reservation/reviews dialogs and schedule selector.
  await page.goto(`${origin}/__payment-review?reserve`)
  await page.getByRole('button',{name:'Book Now',exact:true}).click()
  await page.getByRole('button',{name:'Book Event Venue',exact:true}).click()
  await page.getByRole('button',{name:'View details for The Milestone Event',exact:true}).click()
  const reviewsTrigger=()=>page.getByRole('button',{name:'View Reviews',exact:true}).first()
  const reviews=()=>page.getByRole('dialog',{name:'Venue Reviews',exact:true})
  for(const dismissal of ['button','escape','button']) {
    await reviewsTrigger().click()
    await reviews().waitFor()
    assert.equal(await reviews().getByRole('button').count(),1,'reviews must contain exactly one close control')
    const close=reviews().getByRole('button',{name:'Close venue reviews',exact:true})
    await page.keyboard.press('Tab')
    await close.focus()
    assert.equal(await close.evaluate(el=>el===document.activeElement),true)
    assert.notEqual(await close.evaluate(el=>getComputedStyle(el).boxShadow),'none','keyboard focus must be visible')
    const parent=page.locator('[data-slot="dialog-content"]').filter({has:page.getByText('Our Venues',{exact:true})})
    assert.equal(await parent.evaluate(el=>getComputedStyle(el).pointerEvents),'none','parent controls must be inert')
    await page.screenshot({path:join(output,'venue-reviews-single-close-desktop.png')})
    const scroller=reviews().locator('.overflow-y-auto')
    await scroller.hover()
    await page.mouse.wheel(0,500)
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('[role="dialog"] .overflow-y-auto')).some(el=>el.scrollTop>0))
    if(dismissal==='escape')await page.keyboard.press('Escape')
    else await close.press('Enter')
    await reviews().waitFor({state:'hidden'})
    await page.waitForFunction(()=>document.activeElement?.textContent?.includes('View Reviews'))
    assert.equal(await page.getByRole('button',{name:'Hide details for The Milestone Event',exact:true}).getAttribute('aria-expanded'),'true')
    checks+=6
  }
  await page.setViewportSize({width:390,height:844})
  await reviewsTrigger().scrollIntoViewIfNeeded()
  await reviewsTrigger().click()
  await page.screenshot({path:join(output,'venue-reviews-single-close-mobile.png')})
  await reviews().getByRole('button',{name:'Close venue reviews'}).click()
  await page.getByRole('button',{name:'Select The Milestone Event',exact:true}).click()
  const selectedDate=await page.evaluate(()=>window.scheduleFixture.date)
  for(let n=0;n<2&&await page.getByRole('button',{name:`Select ${selectedDate}`,exact:true}).count()===0;n++)await page.getByRole('button',{name:'Next month',exact:true}).click()
  const availabilitySummary=()=>page.getByRole('region',{name:'Selected date availability',exact:true})
  assert.equal(await availabilitySummary().count(),0,'no permanent scheduling helper before a date is selected')
  await page.getByRole('button',{name:`Select ${selectedDate}`,exact:true}).click()
  const proceed=page.getByRole('button',{name:'Proceed to Details',exact:true})
  assert.equal(await proceed.isDisabled(),true)
  assert.match(await page.getByRole('button',{name:`Select ${selectedDate}`,exact:true}).getAttribute('title'),/^Few slots left/)
  assert.equal(await page.getByRole('listbox').count(),0,'intervals must be visible before opening the dropdown')
  await availabilitySummary().waitFor()
  assert.deepEqual(await availabilitySummary().locator('div').first().locator('p').allTextContents(),['Existing booking(s)','8:00 AM - 10:00 AM','10:00 AM - 2:00 PM'])
  assert.match(await availabilitySummary().textContent(),/Available start times3:00 PM, 4:00 PM/)
  assert.doesNotMatch(await availabilitySummary().textContent(),/Private|EXISTING|CANCELLED|UNRELATED|6:00 AM|2:00 PM - 3:00 PM/,'only sanitized, blocking intervals for this exact venue belong in the summary')
  await availabilitySummary().scrollIntoViewIfNeeded()
  await page.screenshot({path:join(output,'booking-existing-intervals-mobile.png')})
  await page.setViewportSize({width:1440,height:1000})
  await availabilitySummary().waitFor()
  assert.equal(await page.getByRole('dialog',{name:'Reservation Modal'}).evaluate(el=>el.scrollWidth>el.clientWidth+1),false)
  await page.screenshot({path:join(output,'booking-existing-intervals-desktop.png')})
  await page.setViewportSize({width:390,height:844})
  const emptyDate=await page.evaluate(()=>window.scheduleFixture.emptyDate)
  await page.getByRole('button',{name:`Select ${emptyDate}`,exact:true}).click()
  assert.equal(await availabilitySummary().count(),0,'an empty date must clear the old interval summary without an empty-state notice')
  assert.equal(await page.getByText('Existing booking(s)',{exact:true}).filter({visible:true}).count(),0)
  await page.getByRole('button',{name:`Select ${selectedDate}`,exact:true}).click()
  await page.evaluate(()=>window.scheduleFixture.defer())
  await page.getByRole('button',{name:'Next month',exact:true}).click()
  await page.waitForFunction(()=>window.scheduleFixture.stats().pending===1)
  assert.equal(await availabilitySummary().count(),0,'changing month must synchronously hide the old summary')
  await page.getByRole('button',{name:'Previous month',exact:true}).click()
  await page.waitForFunction(()=>window.scheduleFixture.stats().aborted===1)
  await page.getByRole('button',{name:`Select ${selectedDate}`,exact:true}).click()
  await page.evaluate(()=>window.scheduleFixture.release())
  await availabilitySummary().getByText('10:00 AM - 2:00 PM',{exact:true}).waitFor()
  await page.evaluate(()=>window.scheduleFixture.fail())
  await page.getByRole('alert').filter({hasText:'Fixture availability could not be loaded.',visible:true}).waitFor()
  assert.equal(await availabilitySummary().count(),0,'load errors must not show stale or fabricated empty intervals')
  assert.equal(await proceed.isDisabled(),true)
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
  await availabilitySummary().getByText('10:00 AM - 2:00 PM',{exact:true}).waitFor()
  checks+=14
  await page.getByRole('combobox').click()
  const starts=await page.getByRole('option').allTextContents()
  assert.deepEqual(starts,['3:00 PM','4:00 PM'])
  await page.getByRole('option',{name:'3:00 PM',exact:true}).click()
  await page.getByText('Selected 6-Hour Schedule',{exact:true}).filter({visible:true}).waitFor()
  await page.getByText('3:00 PM - 9:00 PM',{exact:true}).filter({visible:true}).waitFor()
  assert.equal(await proceed.isEnabled(),true)
  await page.screenshot({path:join(output,'booking-selected-buffered-schedule-mobile.png')})
  await page.getByRole('button',{name:'Go Back',exact:true}).click()
  await reviewsTrigger().click()
  await reviews().waitFor()
  await page.keyboard.press('Escape')
  await reviews().waitFor({state:'hidden'})
  await page.getByRole('button',{name:'Select The Milestone Event',exact:true}).click()
  await page.getByText('3:00 PM - 9:00 PM',{exact:true}).filter({visible:true}).waitFor()
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(el=>el.textContent.includes('Proceed to Details')&&!el.disabled))
  await page.evaluate(()=>window.scheduleFixture.block())
  await page.waitForFunction(()=>!document.body.textContent.includes('Selected 6-Hour Schedule'))
  assert.equal(await proceed.isDisabled(),true)
  assert.equal(await page.getByRole('combobox').isDisabled(),true)
  assert.equal(await page.getByRole('button',{name:`Select ${selectedDate}`,exact:true}).getAttribute('title'),'Fully booked')
  await page.getByRole('button',{name:'Close',exact:true}).click()
  await page.waitForFunction(()=>!document.body.hasAttribute('data-scroll-locked'))
  await page.getByRole('button',{name:'Book Now',exact:true}).click()
  await page.getByRole('button',{name:'Book Event Venue',exact:true}).waitFor()
  checks+=8

  // Resolve live CMS objects by ID, including renamed venues and reordered rooms.
  const startReservation=async(category,space,room)=>{
    await page.goto(`${origin}/__payment-review?reserve`)
    await page.getByRole('button',{name:'Book Now',exact:true}).click()
    await page.getByRole('button',{name:category==='office'?'Book Office Space':'Book Event Venue',exact:true}).click()
    await page.getByRole('button',{name:`Select ${space}`,exact:true}).click()
    if(room)await page.getByRole('button',{name:`Select ${room}`,exact:true}).click()
    for(let n=0;n<2&&await page.getByRole('button',{name:`Select ${selectedDate}`,exact:true}).count()===0;n++)await page.getByRole('button',{name:'Next month',exact:true}).click()
  }
  await startReservation('venue','The Milestone Event')
  await page.getByRole('button',{name:`Select ${selectedDate}`,exact:true}).click()
  await page.getByRole('combobox').click()
  await page.getByRole('option',{name:'3:00 PM',exact:true}).click()
  const venueRequestCount=await page.evaluate(()=>window.scheduleFixture.stats().requests.length)
  await page.evaluate(()=>{
    const catalog=window.catalogFixture.snapshot()
    window.catalogFixture.patch({venues:catalog.venues.map(v=>v.id==='v1'?{...v,name:'Intermediate venue name'}:v)})
  })
  await page.getByRole('heading',{name:'Intermediate venue name',exact:true}).filter({visible:true}).waitFor()
  await availabilitySummary().waitFor()
  assert.equal(await page.evaluate(()=>window.scheduleFixture.stats().requests.length),venueRequestCount,'renaming a resource must retain the ID-keyed availability result')
  await page.evaluate(()=>{
    const catalog=window.catalogFixture.snapshot()
    window.catalogFixture.patch({venues:catalog.venues.map(v=>v.id==='v1'?{...v,name:'Office Anniversary Hall',price:12000,capacity:'75'}:v).reverse()})
  })
  await page.getByRole('heading',{name:'Office Anniversary Hall',exact:true}).filter({visible:true}).waitFor()
  await availabilitySummary().waitFor()
  assert.equal(await page.evaluate(()=>window.scheduleFixture.stats().requests.length),venueRequestCount,'reordering and renaming must not replace the ID-keyed request')
  assert.equal(await proceed.isEnabled(),true,'a venue named Office must still offer event schedules')
  await proceed.click()
  await page.getByPlaceholder('e.g. 18th Birthday Party').fill('Renamed venue event')
  await page.locator('select').selectOption('others')
  await page.getByPlaceholder('Up to 75 pax').fill('50')
  await page.getByRole('checkbox').check()
  assert.equal(await page.getByRole('button',{name:'Submit Reservation Request',exact:true}).isDisabled(),true,'Other requires a nonblank custom event label')
  await page.getByPlaceholder('Please specify event type...').fill('Office team launch')
  await page.getByRole('button',{name:'Submit Reservation Request',exact:true}).click()
  const confirmation=()=>page.getByRole('dialog',{name:'Confirm Booking Details',exact:true})
  await confirmation().getByText('Office team launch',{exact:true}).waitFor()
  await confirmation().getByText('Office Anniversary Hall',{exact:true}).waitFor()
  await confirmation().getByRole('button',{name:'Confirm Booking',exact:true}).click()
  await page.waitForFunction(()=>window.scheduleFixture.submissions.length===1)
  const venuePayload=await page.evaluate(()=>window.scheduleFixture.submissions[0])
  assert.equal(venuePayload.venueId,'v1')
  assert.equal(venuePayload.spaceId,'v1')
  assert.equal(venuePayload.bookingCategory,'venue')
  assert.equal(venuePayload.eventType,'Office team launch')
  assert.equal(venuePayload.customEventType,'Office team launch')
  assert.equal(venuePayload.totalPrice,12000)
  checks+=10

  await startReservation('office','North Wing','Quartz Suite')
  await page.evaluate(()=>{
    window.paymentFixture.addOfficeBooking()
    const catalog=window.catalogFixture.snapshot()
    window.catalogFixture.patch({offices:catalog.offices.map(o=>o.id==='wing-a'?{...o,name:'Creative Studios',price:17000,rooms:[{id:'harbor',name:'Quartz Suite'},{id:'quartz',name:'Sunrise Studio'}]}:o).reverse()})
  })
  await page.getByRole('heading',{name:'Creative Studios - Sunrise Studio',exact:true}).filter({visible:true}).waitFor()
  await page.getByRole('button',{name:`Select ${selectedDate}`,exact:true}).click()
  await page.getByRole('button',{name:'1 Year',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'previous start date was cleared',visible:true}).waitFor()
  assert.equal(await proceed.isDisabled(),true,'future maintenance must block the entire selected office term')
  await page.getByRole('button',{name:'2 Years',exact:true}).click()
  await page.waitForFunction(()=>window.scheduleFixture.stats().requests.at(-1)?.rentalTerm==='2_years')
  assert.equal(await proceed.isDisabled(),true)
  await page.getByRole('button',{name:'6 Months',exact:true}).click()
  await page.getByText('For 6 Months. The entire rental term must be available. Disabled dates cannot be selected.',{exact:true}).filter({visible:true}).waitFor()
  for(let n=0;n<2&&await page.getByRole('button',{name:`Select ${selectedDate}`,exact:true}).count()===0;n++)await page.getByRole('button',{name:'Next month',exact:true}).click()
  await page.getByRole('button',{name:`Select ${selectedDate}`,exact:true}).waitFor()
  await page.waitForFunction(date=>!document.querySelector('button[aria-label="Select '+date+'"]')?.disabled,selectedDate)
  await page.getByRole('button',{name:`Select ${selectedDate}`,exact:true}).click()
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(el=>el.textContent.includes('Proceed to Details')&&!el.disabled))
  const officeRequest=await page.evaluate(()=>window.scheduleFixture.stats().requests.at(-1))
  assert.equal(officeRequest.rentalTerm,'6_months')
  assert.equal(officeRequest.venueId,'wing-a')
  assert.equal(officeRequest.officeId,'wing-a')
  assert.equal(officeRequest.spaceId,'quartz')
  assert.equal(Object.hasOwn(officeRequest,'roomName'),false,'availability requests must use stable IDs rather than mutable room labels')
  await page.evaluate(()=>{
    const catalog=window.catalogFixture.snapshot()
    window.catalogFixture.patch({offices:catalog.offices.map(o=>o.id==='wing-a'?{...o,rooms:[{id:'harbor',name:'Sunrise Studio'}]}:o)})
  })
  await page.getByRole('alert').filter({hasText:'This space is no longer available. Please select another space.',visible:true}).waitFor()
  assert.equal(await proceed.isDisabled(),true,'a removed room must not silently select the room at its former index or with its former name')
  assert.equal(await page.getByRole('status').filter({visible:true}).count(),0,'an unresolved room is not a permanently loading request')
  await page.evaluate(()=>{
    const catalog=window.catalogFixture.snapshot()
    window.catalogFixture.patch({offices:catalog.offices.map(o=>o.id==='wing-a'?{...o,rooms:[...o.rooms,{id:'quartz',name:'Sunrise Studio'}]}:o)})
  })
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(el=>el.textContent.includes('Proceed to Details')&&!el.disabled))
  await proceed.click()
  await page.getByPlaceholder('e.g. Acme Corp / Juan Dela Cruz').fill('Second company')
  await page.locator('select').selectOption('others')
  await page.getByPlaceholder('Please specify business nature...').fill('Creative services')
  await page.getByRole('checkbox').check()
  await page.getByRole('button',{name:'Submit Reservation Request',exact:true}).click()
  await confirmation().getByText('Creative Studios - Sunrise Studio',{exact:true}).waitFor()
  await confirmation().getByRole('button',{name:'Confirm Booking',exact:true}).click()
  await page.waitForFunction(()=>window.scheduleFixture.submissions.length===1)
  const officePayload=await page.evaluate(()=>window.scheduleFixture.submissions[0])
  assert.equal(officePayload.venueId,'wing-a')
  assert.equal(officePayload.officeId,'wing-a')
  assert.equal(officePayload.spaceId,'quartz')
  assert.equal(officePayload.venue,'Creative Studios - Sunrise Studio')
  assert.equal(officePayload.rentalTerm,'6_months')
  assert.equal(officePayload.officeRentalTerm,'6_months')
  assert.equal(officePayload.contractTerm,'6_months')
  assert.equal(officePayload.eventType,'Creative services')
  assert.equal(officePayload.totalPrice,17000)
  checks+=18

  // Editing actual bookings must preserve exact labels and unmodified intervals.
  const modification=()=>page.getByRole('dialog',{name:'Modify Booking',exact:true})
  const openModification=async patch=>{
    await page.goto(`${origin}/__payment-review?bookings`)
    await page.evaluate(patch=>window.modificationFixture.setup(patch),patch)
    await page.getByText('Modification fixture',{exact:true}).filter({visible:true}).waitFor()
    await page.getByRole('button',{name:'View Details',exact:true}).first().click()
    await page.getByRole('button',{name:'Modify Booking',exact:true}).click()
    await modification().waitFor()
    await modification().getByRole('button',{name:'Proceed to Details',exact:true}).waitFor()
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('[role="dialog"] button')).some(el=>el.textContent.includes('Proceed to Details')&&!el.disabled))
    const request=await page.evaluate(()=>window.scheduleFixture.stats().requests.at(-1))
    const date=await page.evaluate(()=>window.modificationFixture.date)
    assert.equal(request.from,date.slice(0,7)+'-01','opening a later booking must request its own calendar month')
    assert.equal(request.excludeBookingId,'BK-MODIFY','the booking being edited must not block itself')
    checks+=2
  }
  const submitModification=async()=>{
    await modification().getByPlaceholder('Type your reason for requesting this modification...').fill('Correct the booking title')
    assert.deepEqual(await modification().locator('form').evaluate(form=>Array.from(form.elements).filter(el=>el.validity&&!el.validity.valid).map(el=>({field:el.getAttribute('aria-label')||el.name||el.placeholder,value:el.value,message:el.validationMessage}))),[],'the modification form must retain valid values before submission')
    await modification().getByRole('button',{name:'Submit Modification Request',exact:true}).click()
    await page.waitForFunction(()=>window.modificationFixture.submissions.length===1)
    const submission=await page.evaluate(()=>window.modificationFixture.submissions[0])
    for(const field of ['date','endDate','time','startTime','endTime','rentalTerm','officeRentalTerm','contractTerm'])assert.equal(Object.hasOwn(submission.changes,field),false,field+' must not be rewritten by a title-only modification')
    checks++
    return submission.changes
  }
  for(const eventType of ['Birthday','birthday','Office awards / custom celebration','Other']){
    await page.setViewportSize(eventType==='Birthday'?{width:1440,height:1000}:{width:390,height:844})
    await openModification({eventType})
    await modification().getByText('8:00 AM - 2:00 PM',{exact:true}).waitFor()
    await modification().getByRole('button',{name:'Proceed to Details',exact:true}).click()
    assert.equal(await modification().getByRole('combobox',{name:'Event Type',exact:true}).textContent(),eventType)
    await modification().getByRole('combobox',{name:'Event Type',exact:true}).click()
    await page.getByRole('option',{name:eventType,exact:true}).click()
    if(eventType!=='Birthday')assert.equal(await modification().getByRole('textbox',{name:'Custom event type',exact:true}).inputValue(),eventType)
    if(eventType==='Birthday'||eventType==='Office awards / custom celebration'){
      await modification().getByRole('combobox',{name:'Event Type',exact:true}).scrollIntoViewIfNeeded()
      assert.equal(await modification().evaluate(el=>el.scrollWidth>el.clientWidth+1),false)
      await page.screenshot({path:join(output,eventType==='Birthday'?'booking-modify-stored-event-label-desktop.png':'booking-modify-custom-event-label-mobile.png')})
    }
    await modification().getByPlaceholder('e.g. 18th Birthday Party').fill('Corrected event title')
    const changes=await submitModification()
    assert.deepEqual(changes,{eventName:'Corrected event title'})
    checks+=3
  }
  const officeModification={bookingCategory:'office',bookingType:'office',isOfficeRental:true,venueId:'wing-b',officeId:'wing-b',spaceId:'quartz',venue:'Historical wing - Historical room',companyName:'Modification fixture',time:'6 Months',startTime:'',endTime:'',rentalTerm:'6_months'}
  for(const business of ['tech','freelance','agency','corporate','others','Independent research and design','Technology / IT','Others','constructor']){
    await openModification({...officeModification,natureOfBusiness:business,eventType:business})
    await modification().getByRole('heading',{name:'South Wing - Quartz Suite',exact:true}).waitFor()
    await modification().getByRole('button',{name:'Proceed to Details',exact:true}).click()
    assert.equal(await modification().getByRole('combobox',{name:'Nature of Business',exact:true}).inputValue(),business)
    if(!['tech','freelance','agency','corporate'].includes(business))assert.equal(await modification().getByRole('textbox',{name:'Custom nature of business',exact:true}).inputValue(),business)
    if(business==='Independent research and design'){
      await modification().getByRole('textbox',{name:'Custom nature of business',exact:true}).scrollIntoViewIfNeeded()
      assert.equal(await modification().evaluate(el=>el.scrollWidth>el.clientWidth+1),false)
      await page.screenshot({path:join(output,'booking-modify-custom-business-mobile.png')})
    }
    await modification().getByPlaceholder('e.g. Acme Corp',{exact:true}).fill('Corrected company title')
    const changes=await submitModification()
    assert.equal(changes.companyName,'Corrected company title')
    assert.equal(Object.hasOwn(changes,'natureOfBusiness'),false,'stored business labels and codes must not be normalized on an unrelated edit')
    assert.equal(Object.hasOwn(changes,'eventType'),false)
    checks+=3
  }
  await openModification({eventType:'Birthday',startTime:'',endTime:''})
  await modification().getByText('8:00 AM - 2:00 PM',{exact:true}).waitFor()
  await modification().getByRole('button',{name:'Proceed to Details',exact:true}).click()
  await modification().getByPlaceholder('e.g. 18th Birthday Party').fill('Time-only legacy record title')
  assert.deepEqual(await submitModification(),{eventName:'Time-only legacy record title'})
  checks++

  await openModification({eventType:'Birthday'})
  await modification().getByRole('combobox').click()
  await page.getByRole('option',{name:'9:00 AM',exact:true}).click()
  await modification().getByRole('button',{name:'Proceed to Details',exact:true}).click()
  await modification().getByPlaceholder('Type your reason for requesting this modification...').fill('Move the start by one hour')
  await modification().getByRole('button',{name:'Submit Modification Request',exact:true}).click()
  await page.waitForFunction(()=>window.modificationFixture.submissions.length===1)
  assert.deepEqual(await page.evaluate(()=>window.modificationFixture.submissions[0].changes),{time:'9:00 AM - 3:00 PM',startTime:'9:00 AM',endTime:'3:00 PM'})
  checks++

  await openModification({eventType:'Office awards'})
  await modification().getByRole('button',{name:'16',exact:true}).click()
  await modification().getByRole('combobox').click()
  await page.getByRole('option',{name:'8:00 AM',exact:true}).click()
  await modification().getByRole('button',{name:'Proceed to Details',exact:true}).click()
  await modification().getByPlaceholder('Type your reason for requesting this modification...').fill('Move the event to the next day')
  await modification().getByRole('button',{name:'Submit Modification Request',exact:true}).click()
  await page.waitForFunction(()=>window.modificationFixture.submissions.length===1)
  const newDate=await page.evaluate(()=>window.modificationFixture.date.slice(0,8)+'16')
  assert.deepEqual(await page.evaluate(()=>window.modificationFixture.submissions[0].changes),{date:newDate},'a date-only edit must preserve the stored interval formatting')
  checks++

  await openModification({...officeModification,natureOfBusiness:'Original custom business',eventType:'Original custom business'})
  await modification().getByRole('button',{name:'Proceed to Details',exact:true}).click()
  await modification().getByRole('textbox',{name:'Custom nature of business',exact:true}).fill('Updated custom business')
  const businessChanges=await submitModification()
  assert.equal(businessChanges.natureOfBusiness,'Updated custom business')
  assert.equal(businessChanges.eventType,'Updated custom business')
  checks++

  await openModification({eventType:'Original custom event'})
  await modification().getByRole('button',{name:'Proceed to Details',exact:true}).click()
  await modification().getByRole('textbox',{name:'Custom event type',exact:true}).fill('Updated custom event')
  assert.deepEqual(await submitModification(),{eventType:'Updated custom event'})
  checks++
  }
  assert.deepEqual(errors, [], "browser must not report runtime errors")
  checks += 3
  console.log(`Payment review browser checks passed (${checks} assertions/scenarios). Screenshots: ${output}`)
} finally {
  await browser?.close()
  await server.close()
}
