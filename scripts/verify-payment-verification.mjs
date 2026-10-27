/** Local-only checks of the actual admin payment page AND BookingProvider.
 * Service fixtures model acknowledged/lost responses; no .env or live Firebase is loaded.
 * Actual API transactions/authorization are covered by payment-review-api.test.ts.
 */
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"
import tailwindcss from "tailwindcss"
import { chromium } from "playwright"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const output = await mkdtemp(join(process.env.PAYMENT_VERIFICATION_TEMP_DIR || tmpdir(), "payment-verification-"))
console.log(`Payment verification browser artifacts: ${output}`)
const modules = {
  state: `
    import {buildVerifiedPaymentTransition} from '@/src/modules/shared/lib/payment-verification';
    import {buildBookingReceiptProjection} from '@/src/modules/shared/lib/payment-calculations';
    const id='booking-document-86';
    const booking={id,bookingCode:'BK86',userId:'client',eventName:'Dark Rose Celebration',eventType:'Celebration',
      bookingCategory:'venue',venue:'Fixture Hall',status:'pending',bookingStatus:'Pending',paymentStatus:'for_review',
      totalPrice:10000,paymentType:'downpayment',selectedDownpaymentAmount:5000,paymentMethod:'bank',
      date:'2099-03-01',createdAt:'2026-10-01T10:00:00Z',userInfo:{name:'Fixture Client'}};
    const records=[1,2,3].map(n=>({id:'payment-document-'+n,bookingId:id,bookingCode:'BK86',paymentNumber:n,
      customerId:'client',amount:2500,requestedAmount:2500,term:'Down Payment',paymentMethod:'bank',method:'Bank Transfer',
      status:n===1?'Verified':n===2?'Rejected':'For Review',verificationStatus:n===1?'Verified':n===2?'Rejected':'Pending',
      proofUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY4sAAAAASUVORK5CYII=',
      adminNote:n===2?'Earlier submission rejected':'',submittedAt:'2026-10-0'+n+'T10:00:00Z',receiptNumber:'ER-FIXTURE-'+n}));
    const history=records.map(p=>({bookingId:id,paymentId:p.id,receiptNumber:p.receiptNumber,paymentStatus:p.status,
      paymentSubmittedAt:p.submittedAt,paymentMethod:'Bank Transfer',amountPaid:2500,remainingBalance:7500}));
    const data={bookings:[{...booking,paymentReceipts:history,receipt:history[2]}],payments:records,receipts:history};
    const subs=new Set();
    const snapshot=name=>{const docs=(data[name]||[]).map(row=>({id:row.id||row.receiptNumber,data:()=>structuredClone(row)}));
      return {docs,size:docs.length,forEach:fn=>docs.forEach(fn),docChanges:()=>[]}};
    export function onSnapshot(ref,options,next,error){if(typeof options==='function'){error=next;next=options}const sub={name:ref.path,next,error};subs.add(sub);
      queueMicrotask(()=>{if(subs.has(sub))next(snapshot(ref.path))});return()=>subs.delete(sub)};
    export const getDocs=async ref=>snapshot(ref.path);
    export const user={id:location.search.includes('client')?'client':'admin',role:location.search.includes('client')?'client':'admin',name:'Fixture Reviewer'};
    export const toast=value=>window.fixture.toasts.push(value);
    export const forbidden=()=>{throw Error('Unexpected live service or browser database write')};
    const pending=[];
    const emit=name=>{for(const sub of subs)if(sub.name===name)sub.next(snapshot(name))};
    window.fixture={data,toasts:[],requests:[],refreshFailures:0,throwRefresh:false,mode:'ok',pending:()=>pending.length,
      publish(){emit('bookings');emit('payments')},
      restore(saved){Object.assign(data,structuredClone(saved));emit('bookings');emit('payments')},
      finish(){pending.splice(0).forEach(resolve=>resolve())},
      add(){data.payments.push({...records[2],id:'payment-document-4',paymentNumber:4,status:'For Review',verificationStatus:'Pending',
        receiptNumber:'ER-FIXTURE-4',submittedAt:'2026-10-04T10:00:00Z'});emit('payments')},
    };
    const dispatch=window.dispatchEvent.bind(window);
    window.dispatchEvent=event=>{if(event.type==='oneestela_payments_updated'&&window.fixture.throwRefresh){
      window.fixture.refreshFailures++;throw Error('Fixture UI refresh failed AFTER successful persistence')}
      return dispatch(event)};
    const nativeFetch=window.fetch.bind(window);
    window.fetch=async(input,options={})=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(url.origin===location.origin&&url.pathname==='/api/payments/review'){
        const method=options.method||'GET',body=method==='POST'?JSON.parse(options.body):Object.fromEntries(url.searchParams);
        const entry={method,body,headers:options.headers,cache:options.cache};window.fixture.requests.push(entry);
        if(window.fixture.mode==='defer'&&method==='POST')await new Promise(resolve=>pending.push(resolve));
        if(window.fixture.mode==='denied'&&method==='POST'){
          entry.status=403;entry.response={error:'You do not have permission to perform this action.'};
          return new Response(JSON.stringify(entry.response),{status:403});
        }
        let payment=data.payments.find(p=>p.id===body.paymentRecordId);
        if(!payment||body.bookingId!==id)throw Error('Fixture received incorrect document IDs');
        let saved=data.bookings[0];
        if(method==='POST'){
          const transition=buildVerifiedPaymentTransition(saved,data.payments,payment,{verifiedAmount:body.verifiedAmount,adminName:'Fixture Reviewer'});
          if(!transition.alreadyVerified){
            payment=transition.payment;data.payments=data.payments.map(p=>p.id===payment.id?payment:p);
            const receipt={...history.find(r=>r.paymentId===payment.id),bookingId:id,paymentId:payment.id,
              receiptNumber:payment.receiptNumber,paymentStatus:'Verified',reviewSnapshot:payment.reviewSnapshot};
            data.receipts=data.receipts.map(r=>r.paymentId===payment.id?receipt:r);
            const projected=buildBookingReceiptProjection(receipt);
            saved={...transition.booking,paymentReceipts:saved.paymentReceipts.map(r=>r.paymentId===payment.id?projected:r),receipt:projected};data.bookings=[saved];
          }
        }
        entry.status=200;entry.response={booking:structuredClone(saved),payment:structuredClone(payment)};
        if(method==='POST'&&window.fixture.mode==='lost')throw new TypeError('Fixture connection lost after commit');
        if(method==='POST'&&window.fixture.mode==='malformed')return new Response('incomplete JSON',{status:200});
        return new Response(JSON.stringify(entry.response),{status:200,headers:{'Content-Type':'application/json'}});
      }
      if(url.origin!==location.origin||url.pathname.startsWith('/api/'))return forbidden();
      return nativeFetch(input,options);
    };
  `,
  auth: `import {user} from 'virtual:verification-state';export const useAuth=()=>({user,isLoading:false})`,
  toast: `import {toast} from 'virtual:verification-state';export const useToast=()=>({toast})`,
  notifications: `const value={markByBookingId:()=>{}};export const useNotifications=()=>value`,
  notificationService: `export {forbidden as createNotification} from 'virtual:verification-state'`,
  token: `export const getAuthScope=async()=> 'LOCAL-FIXTURE';export const getAuthHeaders=async()=>({'Content-Type':'application/json','X-Local-Fixture':'payment-verification'})`,
  cms: `const value={cmsData:{},paymentInfo:{}};export const useCMS=()=>value`,
  navigation: `const router={replace:()=>{},push:()=>{}},params=new URLSearchParams();export const useRouter=()=>router;export const useSearchParams=()=>params`,
  firebase: `export const db={}`,
  firestore: `export {onSnapshot,getDocs,forbidden as writeBatch,forbidden as runTransaction} from 'virtual:verification-state';
    export const collection=(_,path)=>({path}),doc=()=>({}),query=ref=>ref,orderBy=()=>({}),where=()=>({});`,
  entry: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import Admin from '@/app/(admin)/dashboard/payments/page';
    import Client from '@/app/portal/payments/page';
    import {BookingProvider,useBookings} from '@/src/modules/client/contexts/booking-context';
    import '@/app/globals.css';import 'virtual:verification-state';
    function Observe(){window.fixture.provider=useBookings();return null}
    createRoot(document.getElementById('root')).render(React.createElement(BookingProvider,null,React.createElement(Observe),React.createElement(location.search.includes('client')?Client:Admin)));
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
    "react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react", "clsx", "tailwind-merge", "class-variance-authority",
    "@radix-ui/react-dialog", "@radix-ui/react-select", "@radix-ui/react-slot", "@radix-ui/react-label", "@radix-ui/react-collapsible",
  ] },
  plugins: [{
    name: "local-payment-verification-fixtures", enforce: "pre",
    resolveId(source) {
      if (source.startsWith("virtual:verification-")) return `\0verification-${source.slice("virtual:verification-".length)}.tsx`
      const match = mocks.find(([pattern]) => pattern.test(source.replaceAll("\\", "/")))
      if (match) return `\0verification-${match[1]}.tsx`
      if (/^(firebase|firebase-admin)(\/|$)/.test(source)) throw new Error(`Unstubbed Firebase import: ${source}`)
    },
    load(id) { return modules[id.match(/^\0verification-(.+)\.tsx$/)?.[1]] },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/__payment-verification")) return next()
        response.setHeader("Content-Type", "text/html")
        response.end(await vite.transformIndexHtml(request.url, '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--font-sans:Arial,sans-serif}</style></head><body><div id="root"></div><script type="module" src="/@id/__x00__verification-entry.tsx"></script></body></html>'))
      })
    },
  }],
})

let browser
const results = []
const consoleMessages = []
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true, channel: process.env.PAYMENT_REVIEW_BROWSER_CHANNEL || undefined })
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  const runtimeErrors = []
  page.on("pageerror", error => runtimeErrors.push(error.message))
  page.on("console", message => { if (["error", "warning"].includes(message.type())) consoleMessages.push(message.text()) })
  await page.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort())
  const open = async () => {
    await page.goto(`${origin}/__payment-verification`)
    await page.getByRole("button", { name: "Review", exact: true }).click()
    await page.getByRole("button", { name: /^Submission 3\D/ }).click()
  }
  const confirm = async () => {
    await page.getByRole("button", { name: "Verify Payment", exact: true }).click()
    await page.getByRole("button", { name: "Yes, Verify Payment", exact: true }).click()
  }
  const waitForToast = () => page.waitForFunction(() => window.fixture.toasts.length > 0)
  const evidence = () => page.evaluate(() => ({ requests: window.fixture.requests, toasts: window.fixture.toasts,
    saved: window.fixture.data, refreshFailures: window.fixture.refreshFailures }))

  // Regression: the original provider throws after a successful commit when dispatch/refresh fails.
  await open()
  await page.evaluate(() => { window.fixture.throwRefresh = true })
  await confirm()
  await waitForToast()
  const refresh = await evidence()
  results.push({ scenario: "successful persistence followed by refresh failure", ...refresh })
  console.log("Post-commit refresh evidence:", JSON.stringify({ request: refresh.requests[0]?.body,
    httpStatus: refresh.requests[0]?.status, savedStatus: refresh.saved.payments[2].status,
    toast: refresh.toasts[0], refreshFailures: refresh.refreshFailures }))
  assert.equal(refresh.saved.payments[2].status, "Verified")
  assert.equal(refresh.saved.bookings[0].amountPaid, 5000)
  assert.equal(refresh.toasts[0].title, "Payment Verified")
  assert.equal(refresh.refreshFailures, 1)
  assert.equal(refresh.saved.bookings[0].receipt.reviewSnapshot, undefined)
  assert.equal(refresh.saved.bookings[0].receipt.reviewSnapshotSummary.summary.acceptedTotalPaid, 5000)
  await page.getByRole("button", { name: /^Preview payment proof/ }).waitFor()
  assert.equal(await page.getByRole("button", { name: "Yes, Verify Payment", exact: true }).count(), 0)

  for (const mode of ["lost", "malformed"]) {
    await open()
    await page.evaluate(mode => { window.fixture.mode = mode }, mode)
    await confirm()
    await waitForToast()
    const recovered = await evidence()
    results.push({ scenario: mode, ...recovered })
    assert.equal(recovered.toasts[0].title, "Payment Verified")
    assert.deepEqual(recovered.requests.map(request => request.method), ["POST", "GET"])
    assert.equal(recovered.requests[1].cache, "no-store")
    assert.equal(recovered.requests[1].body.paymentRecordId, "payment-document-3")
    assert.equal(recovered.saved.payments[1].status, "Rejected")
    assert.equal(recovered.saved.bookings[0].remainingBalance, 5000)
  }

  await open()
  await page.evaluate(() => { window.fixture.mode = "denied" })
  await confirm()
  await waitForToast()
  const denied = await evidence()
  results.push({ scenario: "safe permission error", ...denied })
  assert.equal(denied.toasts[0].description, "You do not have permission to perform this action.")
  assert.equal(denied.saved.payments[2].status, "For Review")

  await open()
  await page.evaluate(() => { window.fixture.mode = "defer" })
  await confirm()
  await page.waitForFunction(() => window.fixture.pending() === 1)
  assert.equal(await page.getByRole("button", { name: "Yes, Verify Payment", exact: true }).isDisabled(), true)
  // Try a second DOM click while the first acknowledgement is outstanding.
  await page.getByRole("button", { name: "Yes, Verify Payment", exact: true }).evaluate(button => { button.click(); button.click() })
  await page.evaluate(() => window.fixture.finish())
  await waitForToast()
  const duplicate = await evidence()
  results.push({ scenario: "double click", ...duplicate })
  assert.equal(duplicate.requests.filter(request => request.method === "POST").length, 1)
  assert.equal(duplicate.saved.bookings[0].amountPaid, 5000)
  await page.screenshot({ path: join(output, "verified-desktop.png"), fullPage: true })

  await open()
  await page.evaluate(() => window.fixture.add())
  await page.getByRole("button", { name: /^Submission 3\D/ }).click()
  await confirm()
  await waitForToast()
  const selected = await evidence()
  results.push({ scenario: "selected third while fourth is pending", ...selected })
  assert.equal(selected.requests[0].body.paymentRecordId, "payment-document-3")
  assert.equal(selected.saved.payments[3].status, "For Review")
  await page.getByRole("button", { name: /^Submission 2\D/ }).click()
  assert.equal(await page.getByRole("button", { name: "Verify Payment", exact: true }).count(), 0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(output, "historical-rejection-mobile.png"), fullPage: true })

  // The customer reads the exact same saved payment/receipt/booking state.
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto(`${origin}/__payment-verification?client`)
  await page.getByRole("button", { name: "View Details", exact: true }).first().waitFor()
  await page.evaluate(saved => window.fixture.restore(saved), duplicate.saved)
  await page.getByRole("button", { name: "View Details", exact: true }).first().click()
  await page.getByText("Historical Payment Summary", { exact: true }).waitFor()
  assert.match(await page.getByText("Total Credited Payments:", { exact: true }).locator("..").textContent(), /₱5,000\.00/)
  assert.match(await page.locator(".receipt-print").textContent(), /Verified/)
  assert.match(await page.locator(".receipt-print").textContent(), /₱5,000\.00/)
  await page.getByRole("button", { name: /^Submission History/ }).click()
  await page.getByRole("button", { name: /^Submission 2\D/ }).click()
  await page.getByRole("region", { name: "Review Note", exact: true }).getByText("Earlier submission rejected", { exact: true }).waitFor()
  assert.match(await page.locator(".receipt-print").textContent(), /Rejected/)
  await page.screenshot({ path: join(output, "customer-historical-rejection.png"), fullPage: true })
  assert.deepEqual(runtimeErrors, [])
  console.log("PASS: real admin/customer pages and provider: success, refresh failure, lost/malformed response recovery, permission errors, double-click guard, selected ID, matching totals/receipts, history, and desktop/mobile screenshots.")
} finally {
  await writeFile(join(output, "evidence.json"), JSON.stringify(results, null, 2))
  await writeFile(join(output, "console.json"), JSON.stringify(consoleMessages, null, 2))
  await browser?.close()
  await server.close()
}
