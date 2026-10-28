/** Responsive Chromium checks against the real customer payment and admin booking pages.
 * Provider/service boundaries use local fixtures; no credentials or remote writes are used.
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
const output = await mkdtemp(join(process.env.PAYMENT_SUBMISSION_TEMP_DIR || tmpdir(), "one-estela-payment-submission-"))
const modules = {
  state: `
    import {useSyncExternalStore} from 'react';
    const admin=new URLSearchParams(location.search).get('surface')==='admin';
    const noop=()=>{};
    const booking={
      id:'BK-LAYOUT',bookingCode:'OEP-LAYOUT',userId:'CLIENT',eventName:'Annual Celebration',eventType:'Celebration',
      venue:'The Milestone Event',date:'2099-03-01',startTime:'08:00',endTime:'14:00',guestCount:100,
      createdAt:new Date().toISOString(),totalPrice:10000,paymentType:'downpayment',selectedDownpaymentAmount:5000,
      downPaymentPercentage:50,status:admin?'confirmed':'pending',bookingStatus:admin?'Confirmed':'Pending',
      paymentStatus:admin?'partial':'unpaid',isSlotSecured:admin,contractSigned:false,
      userInfo:{name:'Fixture Customer',email:'customer@example.test',phone:'09000000000'},
      specialRequests:'Please arrange the venue for the celebration.',
    };
    const verified={id:'PAY-VERIFIED',bookingId:booking.id,customerId:'CLIENT',status:'Verified',amount:5000,
      term:'Down Payment',paymentMethod:'bank',submittedAt:'2026-10-20T10:00:00Z'};
    let state={bookings:[booking],paymentRecords:admin?[verified]:[],maintenanceRecords:[],officeRentals:[],isLoading:false,
      cancelBooking:async()=>null,submitPayment:async(id,data)=>{
        window.submissions.push({id,...data});await new Promise(resolve=>window.finishSubmission=resolve);
      },markContractSigned:async()=>{},sendBalanceReminder:async()=>{},manualRecordOnsitePayment:async()=>{},
    };
    const listeners=new Set();
    const publish=next=>{state=next;listeners.forEach(fn=>fn())};
    export function useBookingData(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>state)}
    export const useBookings=useBookingData;
    export const notifications={markByBookingId:noop};
    export const user={id:'CLIENT',role:new URLSearchParams(location.search).get('role')||(admin?'admin':'client'),
      name:'Fixture Customer',permissions:{bookings:true,payments:false}};
    export const router={replace:noop,push:noop};
    window.submissions=[];window.toasts=[];
    export const toast=value=>window.toasts.push(value);
    window.layoutFixture={
      patchBooking(patch){publish({...state,bookings:[{...state.bookings[0],...patch}]})},
      payments(records){publish({...state,paymentRecords:records})},
      snapshot(){return state},
    };
  `,
  booking: `export {useBookingData,useBookings} from 'virtual:submission-state'`,
  auth: `import {user} from 'virtual:submission-state';export const useAuth=()=>({user,isLoading:false})`,
  notifications: `import {notifications} from 'virtual:submission-state';export const useNotifications=()=>notifications`,
  cms: `export const useCMS=()=>({offices:[],getOfficeRooms:()=>[],paymentInfo:{bankName:'BDO',accountNumber:'0012 3456 7890',accountName:'One Estela Place',instructions:'Transfer the exact amount and upload your receipt for admin review.'},cmsData:{venues:[],offices:[]}})`,
  toast: `import {toast} from 'virtual:submission-state';export const useToast=()=>({toast})`,
  navigation: `import {router} from 'virtual:submission-state';const params=new URLSearchParams(location.search);export const useRouter=()=>router;export const useSearchParams=()=>params`,
  firebase: `export const db={}`,
  token: `export const getAuthScope=async()=> 'LOCAL-FIXTURE';export const getAuthHeaders=async()=>({'Content-Type':'application/json','X-Local-Fixture':'payment-submission'})`,
  firestore: `export const collection=()=>({});export const query=ref=>ref;export const orderBy=()=>({});export const where=()=>({});export const getDocs=async()=>({forEach(){}})`,
  entry: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import Client from '@/app/portal/payments/page';import Admin from '@/app/(admin)/dashboard/bookings/page';
    import '@/app/globals.css';import 'virtual:submission-state';
    createRoot(document.getElementById('root')).render(React.createElement(new URLSearchParams(location.search).get('surface')==='admin'?Admin:Client));
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
  [/(?:\/lib\/|^\.\/)auth-token(?:\.ts)?$/, "token"],
  [/^firebase\/firestore$/, "firestore"],
]
const server = await createServer({
  configFile: false, root, cacheDir: join(output, "vite-cache"), logLevel: "error",
  define: { "process.env.NEXT_PUBLIC_PERF_TRACE": JSON.stringify("0") },
  server: { host: "127.0.0.1", port: 0 },
  resolve: { alias: { "@": root, "@shared": join(root, "src/modules/shared") } },
  oxc: { jsx: { runtime: "automatic" } },
  css: { postcss: { plugins: [tailwindcss({ config: join(root, "tailwind.config.ts") })] } },
  optimizeDeps: { noDiscovery: true, include: [
    "react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react", "clsx", "tailwind-merge", "class-variance-authority",
    "@radix-ui/react-dialog", "@radix-ui/react-visually-hidden", "@radix-ui/react-select", "@radix-ui/react-collapsible", "@radix-ui/react-slot", "@radix-ui/react-label", "@radix-ui/react-tooltip", "@radix-ui/react-tabs",
  ] },
  plugins: [{
    name: "local-payment-submission-fixtures", enforce: "pre",
    resolveId(source) {
      if (source.startsWith("virtual:submission-")) return `\0submission-${source.slice("virtual:submission-".length)}.tsx`
      const match = mocks.find(([pattern]) => pattern.test(source.replaceAll("\\", "/")))
      if (match) return `\0submission-${match[1]}.tsx`
    },
    load(id) {
      const match = id.match(/^\0submission-(.+)\.tsx$/)
      if (match) return modules[match[1]]
    },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/__payment-submission")) return next()
        // Match the active portal's available width, sidebar breakpoint, and main padding.
        const html = await vite.transformIndexHtml(request.url, `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
          :root{--font-sans:Arial,sans-serif}body{background:#f8fafc}.fixture-shell{padding:12px}
          @media(min-width:640px){.fixture-shell{padding:16px}}
          @media(min-width:768px){.fixture-shell{padding:24px}}
          @media(min-width:1024px){.fixture-shell{margin-left:256px;padding:32px}}
        </style></head><body class="font-sans"><main class="fixture-shell"><div id="root"></div></main><script type="module" src="/@id/__x00__submission-entry.tsx"></script></body></html>`)
        response.setHeader("Content-Type", "text/html")
        response.end(html)
      })
    },
  }],
})

let browser
let checks = 0
const sizes = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 1000 },
  { name: "narrow-mobile", width: 320, height: 740 },
  { name: "small-desktop", width: 1024, height: 768 },
  { name: "desktop-1280", width: 1280, height: 900 },
]
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true, channel: process.env.PAYMENT_REVIEW_BROWSER_CHANNEL || undefined })
  const page = await browser.newPage()
  const errors = []
  page.on("pageerror", error => { errors.push(error.message); console.error("Browser runtime:", error.message) })
  await page.route("**/*", route => {
    const url = route.request().url()
    return url.startsWith(origin) || url.startsWith("data:") || url.startsWith("blob:") ? route.continue() : route.abort()
  })
  const reference = () => page.getByRole("textbox", { name: "Bank / Transaction Reference Number", exact: true })
  const submit = () => page.getByRole("button", { name: "Submit Verification", exact: true })
  const openClient = async () => {
    await page.goto(`${origin}/__payment-submission?surface=client&bookingId=BK-LAYOUT`)
    await reference().waitFor()
  }
  const noOverflow = async locator => {
    assert.equal(await locator.evaluate(element => element.scrollWidth > element.clientWidth + 1), false, "content must not overflow horizontally")
    checks++
  }
  const inlineError = async message => {
    await page.locator("#bank-reference-error").getByText(message, { exact: true }).waitFor()
    assert.equal(await reference().getAttribute("aria-invalid"), "true")
    assert.match(await reference().getAttribute("aria-describedby"), /bank-reference-error/)
    checks++
  }
  const noReferenceFeedback = async () => {
    assert.equal(await page.locator("#bank-reference-error").count(), 0)
    assert.equal(await reference().getAttribute("aria-invalid"), "false")
    assert.equal(await reference().getAttribute("aria-describedby"), null)
    assert.equal(await reference().evaluate(input => {
      const field = input.parentElement
      return field.lastElementChild === input && Math.abs(field.getBoundingClientRect().bottom - input.getBoundingClientRect().bottom) < 1
    }), true, "a reference without an error must have no helper or reserved feedback space")
    checks++
  }
  const imageFits = async locator => {
    await locator.evaluate(image => image.decode())
    assert.equal(await locator.evaluate(image => {
      const box = image.getBoundingClientRect()
      return image.naturalWidth > 0 && Math.abs(box.width / box.height - image.naturalWidth / image.naturalHeight) < 0.02 && getComputedStyle(image).objectFit === "contain"
    }), true, "image must load uncropped at its original aspect ratio")
    checks++
  }

  for (const size of sizes) {
    await page.setViewportSize(size)
    await openClient()
    await noReferenceFeedback()
    assert.equal(await reference().evaluate(input => input.required), true)
    assert.match(await page.locator('label[for="bank-reference-number"]').textContent(), /\*/)
    assert.equal(await reference().getAttribute("type"), "text")
    assert.equal(await reference().getAttribute("inputmode"), "numeric")
    assert.equal(await reference().getAttribute("maxlength"), null)
    await noOverflow(page.locator("form"))
    await noOverflow(page.locator("html"))
    if (size.width >= 1280) {
      const form = await page.locator("form").boundingBox()
      const summary = await page.getByRole("complementary", { name: "Payment summary" }).boundingBox()
      assert.ok(Math.abs(form.y - summary.y) < 1, "desktop form and summary must align at the top")
      assert.ok(summary.height < form.height - 100, "summary must keep its natural height")
      checks++
    }

    await reference().scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(output, `payment-${size.name}-untouched-reference.png`) })
    await reference().fill("1234")
    assert.equal(await page.locator("#bank-reference-error").count(), 0, "typing before blur must not reveal an error")
    await reference().press("Tab")
    await inlineError("Enter a valid reference number.")
    await page.screenshot({ path: join(output, `payment-${size.name}-four-digit-reference.png`) })
    await reference().fill("12345")
    await noReferenceFeedback()
    await page.screenshot({ path: join(output, `payment-${size.name}-five-digit-reference.png`) })

    await reference().fill("12ab345")
    await reference().press("Tab")
    await inlineError("Enter a valid reference number.")
    assert.equal(await reference().inputValue(), "12ab345", "invalid pasted characters must stay visible")
    await reference().fill("")
    await submit().click()
    await inlineError("Reference number is required.")
    assert.equal(await reference().evaluate(element => element === document.activeElement), true, "invalid submission must focus the reference field")
    assert.equal(await page.getByRole("dialog").count(), 0)
    assert.equal(await page.evaluate(() => window.submissions.length), 0)
    await page.screenshot({ path: join(output, `payment-${size.name}-inline-error.png`) })

    await reference().fill(" 00001 ")
    await reference().press("Tab")
    assert.equal(await reference().inputValue(), "00001")
    await noReferenceFeedback()
    await page.getByText("Please upload your proof of payment for Bank Transfer.", { exact: true }).waitFor()
    const upload = page.locator('input[type="file"]')
    const uploadBox = await upload.boundingBox()
    assert.ok(uploadBox.height < 120, "empty upload area must be compact")
    await upload.setInputFiles(join(root, "public/images/bank_qr.jpg"))
    const preview = page.getByRole("button", { name: "Preview payment proof bank_qr.jpg", exact: true })
    await preview.waitFor()
    await preview.focus()
    await page.keyboard.press("Enter")
    await imageFits(page.getByRole("img", { name: "bank_qr.jpg", exact: true }))
    await noOverflow(page.getByRole("dialog", { name: "Payment Proof", exact: true }))
    await page.screenshot({ path: join(output, `payment-${size.name}-proof-preview.png`) })
    await page.getByRole("button", { name: "Close payment proof preview", exact: true }).click()
    await page.getByRole("button", { name: "Remove payment proof bank_qr.jpg", exact: true }).click()
    await page.locator('input[type="file"]').waitFor()
    await page.locator('input[type="file"]').setInputFiles(join(root, "public/images/bank_qr.jpg"))

    const qr = page.getByRole("img", { name: "Bank Transfer QR Code", exact: true })
    await imageFits(qr)
    assert.match(await qr.getAttribute("src"), /\/images\/bank_qr.jpg$/)
    assert.ok((await qr.boundingBox()).width <= 221, "inline QR must stay reasonably sized")
    await page.getByRole("button", { name: "Enlarge QR code", exact: true }).click()
    await imageFits(page.getByRole("img", { name: "Enlarged bank transfer QR code", exact: true }))
    await noOverflow(page.getByRole("dialog", { name: "Bank Transfer QR Code", exact: true }))
    await page.getByRole("link", { name: "Open original QR image", exact: true }).waitFor()
    await page.screenshot({ path: join(output, `payment-${size.name}-qr-enlarged.png`) })
    await page.getByRole("button", { name: "Close", exact: true }).click()
    // Radix restores focus after the closing dialog unmounts.
    await page.waitForFunction(() => document.activeElement?.textContent.trim() === "Enlarge QR code")
    assert.equal(await page.getByRole("button", { name: "Enlarge QR code", exact: true }).evaluate(element => element === document.activeElement), true, "QR dismissal must restore keyboard focus")

    await submit().click()
    const confirm = page.getByRole("button", { name: "Yes, Submit Bank Transfer", exact: true })
    await confirm.waitFor()
    await page.getByRole("button", { name: "Cancel", exact: true }).click()
    await reference().scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(output, `payment-${size.name}-form.png`), fullPage: true })
    checks += 12
  }

  // Validate actual form behavior, including Enter submission and raw paste preservation.
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openClient()
  await page.locator('input[type="file"]').setInputFiles(join(root, "public/images/bank_qr.jpg"))
  for (const value of ["", " ", "1", "12", "123", "1234", "12345a", "12345-67890123", "12 345", "12345\t67890"]) {
    await reference().fill(value)
    const actual = await reference().inputValue()
    assert.equal(actual, value, "input must not silently filter pasted content")
    await reference().press("Enter")
    await inlineError(value.trim() ? "Enter a valid reference number." : "Reference number is required.")
    assert.equal(await page.getByRole("dialog").count(), 0)
  }
  for (const value of ["12345", "00001", "123456789012", "1234567890123", "12345678901234", "0".repeat(121)]) {
    await reference().fill(value)
    await reference().press("Enter")
    await page.getByRole("button", { name: "Yes, Submit Bank Transfer", exact: true }).waitFor()
    await page.getByRole("button", { name: "Cancel", exact: true }).click()
    assert.equal(await reference().inputValue(), value)
    checks++
  }
  for (const pasted of ["12\n345", "12\r\n345"]) {
    await reference().fill("")
    await reference().evaluate((input, text) => {
      const clipboardData = new DataTransfer()
      clipboardData.setData("text/plain", text)
      input.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }))
    }, pasted)
    await submit().click()
    await inlineError("Enter a valid reference number.")
    assert.equal(await page.getByRole("dialog").count(), 0, "line breaks must not be silently removed into an accepted reference")
  }
  await reference().fill(" 00001 ")
  await submit().click()
  const confirm = page.getByRole("button", { name: "Yes, Submit Bank Transfer", exact: true })
  await confirm.evaluate(button => { button.click(); button.click() })
  await page.waitForFunction(() => window.submissions.length === 1)
  assert.equal(await page.getByRole("button", { name: "Submitting...", exact: true }).isDisabled(), true)
  const submitted = await page.evaluate(() => window.submissions[0])
  assert.equal(submitted.bankReferenceNumber, "00001")
  assert.equal(submitted.amount, 5000)
  assert.match(submitted.proof, /^data:image\/jpeg;base64,/)
  await page.evaluate(() => window.finishSubmission())
  await page.getByRole("button", { name: "Submitting...", exact: true }).waitFor({ state: "hidden" })

  await openClient()
  await page.locator('input[type="file"]').setInputFiles({ name: "proof.pdf", mimeType: "application/pdf", buffer: Buffer.from("not an image") })
  assert.equal(await page.getByRole("button", { name: /^Preview payment proof/ }).count(), 0)
  assert.equal(await page.evaluate(() => window.toasts.at(-1).title), "Invalid File")
  await page.locator('input[type="file"]').setInputFiles({ name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) })
  assert.equal(await page.getByRole("button", { name: /^Preview payment proof/ }).count(), 0)
  assert.equal(await page.evaluate(() => window.toasts.at(-1).title), "File Too Large")
  await reference().fill("invalid-unused-reference")
  await page.getByRole("button", { name: "Pay at the Office", exact: true }).click()
  assert.equal(await reference().count(), 0)
  await page.locator('button[type="submit"]').click()
  await page.getByRole("button", { name: "Yes, Pay at the Office", exact: true }).click()
  await page.waitForFunction(() => window.submissions.length === 1)
  const cash = await page.evaluate(() => window.submissions[0])
  assert.equal(cash.method, "cash")
  assert.equal(cash.bankReferenceNumber, undefined)
  assert.equal(cash.proof, undefined)
  await page.evaluate(() => window.finishSubmission())
  checks += 12

  const openAdmin = async (extra = "") => {
    await page.goto(`${origin}/__payment-submission?surface=admin${extra}`)
    await page.getByRole("button", { name: "View Details", exact: true }).click()
    await page.getByRole("region", { name: "Booking details content", exact: true }).waitFor()
  }
  const details = () => page.getByRole("region", { name: "Booking details content", exact: true })
  const bookingDialog = () => page.getByRole("dialog", { name: "Annual Celebration", exact: true })
  for (const size of sizes) {
    await page.setViewportSize(size)
    await openAdmin()
    const dialog = bookingDialog()
    assert.equal(await dialog.getByRole("button", { name: /close/i }).count(), 1)
    const labels = await dialog.locator("dt").allTextContents()
    assert.deepEqual(labels, ["Customer", "Email", "Booking Date", "Event Date", "End Date", "Venue / Office", "Guests", "Time", "Booking ID", "Event Type"])
    for (const name of ["Send Balance Reminder", "Record Onsite Payment", "Mark Contract as Signed"]) {
      assert.equal(await dialog.getByRole("button", { name, exact: true }).isEnabled(), true)
    }
    const footer = dialog.locator("footer")
    const footerBox = await footer.boundingBox()
    const contentBox = await details().boundingBox()
    const dialogBox = await dialog.boundingBox()
    assert.ok(dialogBox.y >= 15 && dialogBox.y + dialogBox.height <= size.height - 15, "modal must fit the viewport")
    assert.ok(contentBox.height >= 150, "content must retain usable height")
    assert.ok(contentBox.y + contentBox.height <= footerBox.y + 1, "footer must not cover details")
    assert.ok(footerBox.height <= 220, "management 56px actions must stack compactly")
    await noOverflow(dialog)
    await page.screenshot({ path: join(output, `booking-${size.name}-details.png`) })

    await page.evaluate(() => window.layoutFixture.patchBooking({
      userInfo: { name: "VeryLongCustomerName".repeat(12), email: "longemail".repeat(15) + "@example.test" },
      specialRequests: "Keep every detail visible. ".repeat(100) + "LONGUNBROKENVALUE".repeat(30),
    }))
    await details().getByText(/VeryLongCustomerName/).waitFor()
    await noOverflow(dialog)
    assert.equal(await details().evaluate(element => element.scrollHeight > element.clientHeight), true)
    const scrollers = await dialog.evaluate(element => [element, ...element.querySelectorAll("*")].filter(node =>
      /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1,
    ).length)
    assert.equal(scrollers, 1, "modal must have one usable scroll region")
    await details().focus()
    await page.keyboard.press("End")
    await page.waitForFunction(() => document.querySelector('[aria-label="Booking details content"]').scrollTop > 0)
    assert.equal(await footer.evaluate(element => {
      const box = element.getBoundingClientRect()
      return box.bottom <= innerHeight && box.top >= 0
    }), true, "footer must remain visible while content scrolls")
    await page.screenshot({ path: join(output, `booking-${size.name}-long-values.png`) })
    await page.getByRole("button", { name: "Close booking details", exact: true }).click()
    await page.waitForFunction(() => !document.body.hasAttribute("data-scroll-locked"))
    checks += 12
  }

  // Existing action handlers still open their existing workflow dialogs.
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openAdmin("&role=staff")
  await bookingDialog().getByRole("button", { name: "Send Balance Reminder", exact: true }).click()
  await page.getByRole("dialog", { name: "Send Balance Reminder?", exact: true }).waitFor()
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await bookingDialog().getByRole("button", { name: "Record Onsite Payment", exact: true }).click()
  await page.getByRole("dialog", { name: "Record Onsite Payment", exact: true }).waitFor()
  await page.getByRole("dialog", { name: "Record Onsite Payment", exact: true }).getByRole("button", { name: /close/i }).click()
  await bookingDialog().getByRole("button", { name: "Mark Contract as Signed", exact: true }).click()
  await page.getByRole("dialog", { name: "Mark Contract as Signed?", exact: true }).waitFor()
  await page.getByRole("button", { name: "Cancel", exact: true }).click()

  await page.evaluate(() => window.layoutFixture.patchBooking({ contractSigned: true, contractStatus: "Signed" }))
  await bookingDialog().getByText("Contract Status: Signed", { exact: true }).waitFor()
  assert.equal(await bookingDialog().getByRole("button", { name: "Mark Contract as Signed", exact: true }).count(), 0)
  await page.evaluate(() => window.layoutFixture.payments([
    ...window.layoutFixture.snapshot().paymentRecords,
    { id: "PAY-PENDING", bookingId: "BK-LAYOUT", status: "For Verification", amount: 1000, paymentMethod: "bank", term: "Down Payment" },
  ]))
  await page.waitForFunction(() => [...document.querySelectorAll('footer button')].some(button => button.textContent.includes('Record Onsite Payment') && button.disabled))
  assert.equal(await bookingDialog().getByRole("button", { name: "Record Onsite Payment", exact: true }).isDisabled(), true)
  checks += 5

  // Office-only details are retained, and a long modification reason scrolls with the body.
  await openAdmin()
  await page.evaluate(() => window.layoutFixture.patchBooking({
    venue: "Office Space", isOfficeRental: true, companyName: "Fixture Company", natureOfBusiness: "Services",
    officeRentalTerm: "1_year", status: "modification_under_review", modificationRequested: true,
    modificationStatus: "Under Review", modificationReason: "Detailed modification reason. ".repeat(100),
  }))
  for (const label of ["Company Name", "Nature of Business", "Rental Term"]) await details().locator("dt").getByText(label, { exact: true }).waitFor()
  assert.equal(await bookingDialog().getByRole("button", { name: "Approve Modification", exact: true }).isEnabled(), true)
  assert.ok((await bookingDialog().locator("footer").boundingBox()).height <= 220)
  assert.deepEqual(errors, [], "browser must not report runtime errors")
  checks += 4
  console.log(`Payment submission / booking details browser checks passed (${checks} assertions/scenarios). Screenshots: ${output}`)
} finally {
  console.log(`Responsive browser artifacts: ${output}`)
  await browser?.close()
  await server.close()
}
