/** Report output checks against the real reports page component with local fixtures. */
import assert from "node:assert/strict"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"
import tailwindcss from "tailwindcss"
import { chromium } from "playwright"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const output = await mkdtemp(join(tmpdir(), "one-estela-report-print-"))
const fixtureModules = {
  auth: `export const useAuth=()=>({user:{role:'admin',fullName:'Print Fixture Admin'}})`,
  booking: `export const useBookingData=()=>({bookings:[
     {id:'BK-PRINT-1',bookingCategory:'venue',venueId:'venue-1',spaceId:'venue-1',venue:'Main Hall',eventName:'Fixture Conference',eventType:'Conference',date:'2026-10-01',status:'confirmed',totalPrice:10000,totalAmount:10000,amountPaid:5000,paymentStatus:'partial',refundStatus:'refunded',refundAmount:2000,refundedAmount:2000,userInfo:{name:'Fixture Client'}},
    {id:'BK-PRINT-2',bookingCategory:'venue',venueId:'venue-1',spaceId:'venue-1',venue:'Main Hall',eventName:'Fixture Workshop',eventType:'Workshop',date:'2026-10-15',status:'pending',totalPrice:7500,totalAmount:7500,amountPaid:0,paymentStatus:'unpaid',userInfo:{name:'Another Client'}}
  ],paymentRecords:[],isLoading:false})`,
  cms: `export const useCMS=()=>({cmsData:{venues:[{id:'venue-1',name:'Main Hall',isArchived:false,isHidden:false,isBookable:true}],offices:[]}})`,
  toast: `export const useToast=()=>({toast:()=>{}})`,
  navigation: `export const useRouter=()=>({replace:()=>{}})`,
  entry: `import React from 'react';import {createRoot} from 'react-dom/client';import Reports from '@/app/(admin)/dashboard/reports/page';import '@/app/globals.css';createRoot(document.getElementById('root')).render(React.createElement(Reports));`,
}

const mocks = [
  [/\/auth\/auth-context(?:\.tsx)?$/, "auth"],
  [/\/client\/contexts\/booking-context(?:\.tsx)?$/, "booking"],
  [/\/admin\/contexts\/cms-context(?:\.tsx)?$/, "cms"],
  [/\/hooks\/use-toast(?:\.tsx?)?$/, "toast"],
  [/^next\/navigation$/, "navigation"],
]

const server = await createServer({
  configFile: false,
  envFile: false,
  envDir: false,
  root,
  cacheDir: join(output, "vite-cache"),
  logLevel: "silent",
  resolve: { alias: { "@": root, "@shared": join(root, "src/modules/shared") } },
  server: { host: "127.0.0.1", port: 0 },
  oxc: { jsx: { runtime: "automatic" } },
  css: { postcss: { plugins: [tailwindcss({ config: join(root, "tailwind.config.ts") })] } },
  optimizeDeps: {
    noDiscovery: true,
    include: [
      "react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react", "clsx", "tailwind-merge",
      "class-variance-authority", "recharts", "exceljs", "@radix-ui/react-select", "@radix-ui/react-slot",
    ],
  },
  plugins: [{
    name: "local-report-print-fixtures",
    enforce: "pre",
    resolveId(source) {
      if (source === "virtual:report-print-entry") return "\0report-print-entry.tsx"
      const match = mocks.find(([pattern]) => pattern.test(source.replaceAll("\\", "/")))
      return match ? `\0report-print-${match[1]}.tsx` : undefined
    },
    load(id) {
      const match = id.match(/^\0report-print-(.+)\.tsx$/)
      return match ? fixtureModules[match[1]] : undefined
    },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/__report-print")) return next()
        response.setHeader("Content-Type", "text/html")
        response.end(await vite.transformIndexHtml(request.url, '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--font-sans:Inter,ui-sans-serif,system-ui,sans-serif}body{min-height:200vh}</style></head><body class="font-sans oe-light-surface"><div id="root"></div><script type="module" src="/@id/__x00__report-print-entry.tsx"></script></body></html>'))
      })
    },
  }],
})

let browser
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true, channel: process.env.PAYMENT_REVIEW_BROWSER_CHANNEL || undefined })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on("pageerror", error => console.error(`Report browser error: ${error.stack || error.message}`))
  page.on("console", message => { if (message.type() === "error") console.error(`Report browser console: ${message.text()}`) })
  await page.route("**/*", route => {
    const url = new URL(route.request().url())
    return url.origin === origin || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort()
  })
  await page.goto(`${origin}/__report-print`)
  await page.locator('[data-report-dashboard]').waitFor({ state: "attached" })
  assert.equal(await page.locator('[data-report-print-report]').evaluate(element => getComputedStyle(element).display), "none")

  const dashboardText = await page.locator('[data-report-dashboard]').innerText()
  assert.match(dashboardText, /Received Payments:/)
  assert.match(dashboardText, /Net Received Cash:/)
  assert.match(dashboardText, /Total Booking Value/i)
  assert.match(dashboardText, /₱10,000\.00/)
  assert.match(dashboardText, /₱5,000\.00/)
  assert.match(dashboardText, /₱2,000\.00/)
  assert.match(dashboardText, /₱3,000\.00/)

  await page.locator('[aria-label="Year"]').click()
  await page.getByRole("option", { name: "2026", exact: true }).click()
  await page.locator('[aria-label="Month"]').click()
  await page.getByRole("option", { name: "Oct", exact: true }).click()

  const [excelDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export Excel", exact: true }).click(),
  ])
  const excelPath = await excelDownload.path()
  assert.ok(excelPath, "Excel export should produce a local download")
  const { default: ExcelJS } = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await readFile(excelPath))
  const worksheet = workbook.getWorksheet("Booking Records")
  assert.ok(worksheet, "Excel export should contain the Booking Records sheet")
  assert.equal(worksheet.getCell("A4").value, "Report Period: Oct 2026")
  assert.equal(worksheet.getCell("A6").value, "Filters Applied: Year: 2026 | Month: Oct")
  assert.deepEqual(
    worksheet.getRow(20).values.slice(1),
    [
      "Booking ID", "Event Name", "Client", "Date", "Venue", "Booking Status", "Payment Status",
      "Total Booking Value", "Received Payments", "Verified Payments", "Outstanding Balance",
      "Refund Status", "Processed Refund", "Net Received Cash",
    ],
  )
  const excelSummary = new Map()
  for (let rowNumber = 9; rowNumber < 20; rowNumber++) {
    excelSummary.set(worksheet.getCell(rowNumber, 1).value, worksheet.getCell(rowNumber, 9).value)
  }
  assert.equal(excelSummary.get("Total Booking Value"), 17500)
  assert.equal(excelSummary.get("Received Payments"), 5000)
  assert.equal(excelSummary.get("Processed Refunds"), 2000)
  assert.equal(excelSummary.get("Net Received Cash"), 3000)
  const excelRows = new Map()
  for (let rowNumber = 21; rowNumber <= worksheet.rowCount; rowNumber++) {
    excelRows.set(worksheet.getCell(rowNumber, 1).value, worksheet.getRow(rowNumber).values.slice(1))
  }
  assert.equal(excelRows.get("BK-PRINT-1")[7], 10000)
  assert.equal(excelRows.get("BK-PRINT-1")[8], 5000)
  assert.equal(excelRows.get("BK-PRINT-1")[12], 2000)
  assert.equal(excelRows.get("BK-PRINT-1")[13], 3000)

  await page.emulateMedia({ media: "print" })
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")))
  await page.locator('[data-report-print-report]').waitFor({ state: "visible" })
  const printText = await page.locator('[data-report-print-report]').innerText()
  assert.match(printText, /Reporting Period: Oct 2026/)
  assert.match(printText, /Applied Filters: Year: 2026 \| Month: Oct/)
  assert.match(printText, /Total Booking Value/i)
  assert.match(printText, /Received Payments/i)
  assert.match(printText, /Net Received Cash/i)
  assert.match(printText, /₱17,500\.00/)
  assert.match(printText, /₱10,000\.00/)
  assert.match(printText, /₱5,000\.00/)
  assert.match(printText, /₱2,000\.00/)
  assert.match(printText, /₱3,000\.00/)
  const typography = await page.evaluate(() => {
    const read = selector => {
      const element = document.querySelector(selector)
      if (!element) throw new Error(`Missing ${selector}`)
      const style = getComputedStyle(element)
      return { color: style.color, family: style.fontFamily, weight: style.fontWeight }
    }
    return {
      report: read('[data-report-print-report]'),
      bannerHeading: read('[data-report-print-banner] h1'),
      titleDescription: read('[data-report-print-title] p'),
      tableHeading: read('[data-report-print-table] th'),
      tableValue: read('[data-report-print-table] td'),
      dashboardDisplay: getComputedStyle(document.querySelector('[data-report-dashboard]')).display,
    }
  })
  assert.equal(typography.report.color, "rgb(0, 0, 0)")
  assert.match(typography.report.family, /^Inter/)
  assert.equal(typography.bannerHeading.weight, "700")
  assert.equal(typography.titleDescription.weight, "400")
  assert.equal(typography.titleDescription.color, "rgb(0, 0, 0)")
  assert.equal(typography.tableHeading.weight, "700")
  assert.equal(typography.tableValue.weight, "400")
  assert.equal(typography.tableValue.color, "rgb(0, 0, 0)")
  assert.equal(typography.dashboardDisplay, "none")

  const pdf = await page.pdf({ format: "A4", landscape: true, printBackground: true })
  assert.ok(pdf.length > 10_000, "print preview should produce a non-empty PDF")
  console.log(`Report print checks passed. PDF bytes: ${pdf.length}. Artifacts: ${output}`)
} finally {
  await browser?.close()
  await server.close()
}
