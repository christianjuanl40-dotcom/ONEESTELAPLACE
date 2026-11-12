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
  auth: `const defaultUser={role:'admin',fullName:'Print Fixture Admin',name:'Print Fixture Admin'};export const useAuth=()=>({user:JSON.parse(window.localStorage.getItem('__reportPrintFixtureUser')||JSON.stringify(defaultUser))})`,
  booking: `export const useBookingData=()=>({bookings:[
     {id:'BK-PRINT-1',bookingCategory:'venue',venueId:'venue-1',spaceId:'venue-1',venue:'Main Hall',eventName:'Fixture Conference',eventType:'Conference',date:'2026-10-01',status:'confirmed',totalPrice:10000,totalAmount:10000,amountPaid:5000,paymentStatus:'partial',refundStatus:'refunded',refundAmount:2000,refundedAmount:2000,userInfo:{name:'Fixture Client'}},
     {id:'BK-PRINT-2',bookingCategory:'venue',venueId:'venue-1',spaceId:'venue-1',venue:'Main Hall',eventName:'Fixture Workshop',eventType:'Workshop',date:'2026-10-15',status:'pending',totalPrice:7500,totalAmount:7500,amountPaid:0,paymentStatus:'unpaid',userInfo:{name:'Another Client'}},
      ...Array.from({length:18},(_,index)=>({id:'BK-TABLE-' + (index + 1),bookingCategory:'venue',venueId:'venue-1',spaceId:'venue-1',venue:'Main Hall',eventName:'Table Fixture ' + (index + 1) + (index === 11 ? ' — Annual Stakeholder and Financial Planning Conference with Extended Programme' : ''),eventType:'Workshop',date:'2026-09-01',status:index % 2 === 0 ? 'confirmed' : 'pending',totalPrice:100,totalAmount:100,amountPaid:0,paymentStatus:'unpaid',userInfo:{name:'Table Client ' + (index + 1) + (index === 11 ? ' — Alexandra Benjamin de la Cruz and Partners' : '')}}))
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

function getPdfPageCount(pdf) {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length
}

async function assertPrintDocumentLayout(page, expectedPreparedBy) {
  const report = page.locator('[data-report-print-report]')
  const pages = report.locator('[data-report-print-page]')
  const pageCount = await pages.count()
  assert.ok(pageCount > 0, "print output should contain at least one controlled page")
  assert.equal(Number(await report.getAttribute("data-report-print-page-count")), pageCount)
  assert.equal(await report.locator('[data-report-print-summary]').count(), 1, "summary should be rendered once")
  assert.equal(await report.locator('[data-report-print-meta]').count(), 0, "generation metadata should not remain in the top section")
  assert.equal(await report.locator('[data-report-print-title]').count(), 0, "metadata title block should not be duplicated below the header")
  assert.equal(await report.locator('[data-report-print-selection]').count(), 0, "selection metadata should not be duplicated below the header")
  assert.equal(await report.locator('[data-report-print-summary-section]').count(), 2, "summary should have booking and payment/refund sections")

  const details = await pages.evaluateAll((nodes) => nodes.map((node) => {
    const header = node.querySelector('[data-report-print-banner]')
    const body = node.querySelector('[data-report-print-page-body]')
    const footer = node.querySelector('[data-report-print-footer]')
    const pageNumber = node.querySelector('[data-report-print-page-number]')
    const pageRect = node.getBoundingClientRect()
    const headerRect = header?.getBoundingClientRect()
    const bodyRect = body?.getBoundingClientRect()
    const footerRect = footer?.getBoundingClientRect()
    const contentBottom = body
      ? Math.max(body.getBoundingClientRect().top, ...Array.from(body.querySelectorAll("*"), (child) => child.getBoundingClientRect().bottom))
      : 0

    return {
      heading: header?.querySelector("h1")?.textContent?.trim(),
      reportTitle: header?.querySelector("h2")?.textContent?.trim(),
      headerMetadata: header?.querySelector('[data-report-print-header-context]')?.textContent?.trim(),
      footer: footer?.textContent?.trim(),
      pageNumber: pageNumber?.textContent?.trim(),
      bodyText: body?.textContent?.trim(),
      headerBottom: headerRect?.bottom ?? 0,
      bodyTop: bodyRect?.top ?? 0,
      contentBottom,
      footerTop: footerRect?.top ?? 0,
      footerBottom: footerRect?.bottom ?? 0,
      pageBottom: pageRect.bottom,
      bodyScrollHeight: body?.scrollHeight ?? 0,
      bodyClientHeight: body?.clientHeight ?? 0,
      tableHeadings: node.querySelectorAll('[data-report-print-table] thead th').length,
      tableRows: node.querySelectorAll('[data-report-print-table] tbody tr').length,
      charts: Array.from(node.querySelectorAll('[data-report-print-chart-canvas]'), (chart) => {
        const rect = chart.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      }),
    }
  }))

  assert.equal(details.length, pageCount)
  const summaryPageNumber = await report.locator('[data-report-print-summary]').evaluate((summary) => (
    summary.closest('[data-report-print-page]')?.getAttribute("data-report-print-page")
  ))
  assert.equal(summaryPageNumber, "1", "Report Summary should remain on the first page")
  const generatedValues = new Set()
  details.forEach((detail, index) => {
    assert.equal(detail.heading, "ONE ESTELA PLACE", `page ${index + 1} should repeat the brand heading`)
    assert.equal(detail.reportTitle, "Venue Booking Report", `page ${index + 1} should repeat the report title`)
    assert.match(detail.headerMetadata, /Reporting Period:/, `page ${index + 1} should repeat report metadata in the header`)
    assert.doesNotMatch(detail.bodyText, /Financial Report/i, `page ${index + 1} should not use the old report title`)
    assert.match(detail.footer, new RegExp(`Prepared By: ${expectedPreparedBy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
    assert.match(detail.footer, /Generated: [^|]+ \| [0-9]+:[0-9]{2} (AM|PM)/)
    assert.equal(detail.pageNumber, `Page ${index + 1} of ${pageCount}`)
    generatedValues.add(detail.footer.match(/Generated: ([^]+?)\s+Page /)?.[1] || "")
    assert.ok(detail.bodyText, `page ${index + 1} should not be blank`)
    assert.ok(detail.headerBottom <= detail.bodyTop + 1, `page ${index + 1} header should not overlap the body`)
    assert.ok(detail.contentBottom <= detail.footerTop + 1, `page ${index + 1} content should not overlap the footer`)
    assert.ok(detail.footerBottom <= detail.pageBottom + 1, `page ${index + 1} footer should fit the page shell`)
    assert.ok(detail.bodyScrollHeight <= detail.bodyClientHeight + 1, `page ${index + 1} content should not be clipped`)
    detail.charts.forEach((chart) => {
      assert.ok(chart.width > 0 && chart.height > 0, `page ${index + 1} charts should remain readable`)
    })
  })
  assert.equal(generatedValues.size, 1, "all pages should reuse one generated timestamp")
  const summaryText = await report.locator('[data-report-print-summary]').innerText()
  assert.match(summaryText, /BOOKING SUMMARY/)
  assert.match(summaryText, /PAYMENTS & REFUNDS SUMMARY/)
  assert.match(summaryText, /TOTAL BOOKINGS:/)
  assert.match(summaryText, /NET RECEIVED CASH:/)

  const tablePages = details.filter((detail) => detail.tableHeadings > 0)
  tablePages.forEach((detail, index) => {
    assert.equal(detail.tableHeadings, 14, `booking table page ${index + 1} should repeat all column headings`)
    assert.ok(detail.tableRows > 0, `booking table page ${index + 1} should contain records or the empty-state row`)
  })

  return { pageCount, details }
}

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
   assert.match(dashboardText, /Received Payments/)
   assert.match(dashboardText, /Net Received Cash/)
   assert.match(dashboardText, /Total Booking Value/i)
   assert.match(dashboardText, /Records/)
   assert.match(dashboardText, /Confirmed/)
   assert.match(dashboardText, /Processed Refunds/)
   assert.doesNotMatch(dashboardText, /Booking Summary/)
   assert.doesNotMatch(dashboardText, /Payments & Refunds Summary/)
   assert.equal(await page.locator('[data-report-controls]').count(), 1)
   assert.equal(await page.locator('[data-report-summary]').count(), 1)
   assert.equal(await page.locator('[data-report-summary] > div').count(), 6, "live report summary should use six compact KPI cells")
   assert.equal(await page.locator('[data-report-dashboard] [data-report-summary-section]').count(), 0)
   await page.locator('[aria-label="Report period"]').click()
   assert.equal(await page.getByRole("option").filter({ hasText: /^(All Dates|Specific Date|Specific Week|Specific Month|Specific Year|Custom Date Range)$/ }).count(), 6)
   await page.keyboard.press("Escape")
   assert.match(dashboardText, /₱10,000\.00/)
   assert.match(dashboardText, /₱5,000\.00/)
   assert.match(dashboardText, /₱2,000\.00/)
   assert.match(dashboardText, /₱3,000\.00/)

   const selectReportPeriod = async (label) => {
     await page.locator('[aria-label="Report period"]').click()
     await page.getByRole("option", { name: label, exact: true }).click()
   }
   const selectFilterOption = async (label, option) => {
     await page.locator(`[aria-label="${label}"]`).click()
     await page.getByRole("option", { name: option, exact: true }).click()
   }
   const summaryText = async () => page.locator('[data-report-summary]').innerText()

  await page.locator('#report-search').fill('  Table Client 7  ')
  await page.locator('[data-report-dashboard] [data-slot="table"] tbody tr').waitFor()
  assert.match(await page.locator('[data-report-dashboard]').innerText(), /BK-TABLE-7/)
  assert.doesNotMatch(await page.locator('[data-report-dashboard]').innerText(), /BK-TABLE-8/)
  await page.getByRole('button', { name: 'Clear booking search', exact: true }).click()

  await page.getByRole('button', { name: /Sort by Total Booking Value/ }).click()
  const firstSortedRow = await page.locator('[data-report-dashboard] [data-slot="table"] tbody tr').first().innerText()
  assert.match(firstSortedRow, /BK-TABLE-1/)

  assert.match(await page.locator('[data-report-dashboard]').innerText(), /Page 1 of 2/)
  await page.getByRole('button', { name: 'Go to next report page', exact: true }).click()
  assert.match(await page.locator('[data-report-dashboard]').innerText(), /Page 2 of 2/)
  await page.locator('#report-rows-per-page').selectOption('25')
  assert.match(await page.locator('[data-report-dashboard]').innerText(), /Page 1 of 1/)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('[data-report-dashboard] article').first().waitFor()
  assert.equal(await page.locator('[data-report-dashboard] [data-slot="table"]').isVisible(), false)
  await page.getByRole('button', { name: 'View Details', exact: true }).first().click()
  assert.match(await page.locator('[data-report-dashboard]').innerText(), /Outstanding Balance/)
  await page.setViewportSize({ width: 1440, height: 1000 })
  for (const width of [320, 375, 768, 1024, 1280, 1366, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 })
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
       true,
       `report dashboard should not create page-level horizontal overflow at ${width}px`,
      )
      assert.equal(
        await page.locator('[data-report-dashboard] [data-slot="table"]').isVisible(),
        width >= 1280,
        `summary table breakpoint should be stable at ${width}px`,
      )
      assert.equal(
        await page.locator('[data-report-dashboard] article[data-report-record]').first().isVisible(),
        width < 1280,
        `compact report records breakpoint should be stable at ${width}px`,
      )
      const sections = await page.evaluate(() => {
       const controls = document.querySelector('[data-report-controls]')?.getBoundingClientRect()
       const summary = document.querySelector('[data-report-summary]')?.getBoundingClientRect()
       return controls && summary ? { controlsBottom: controls.bottom, summaryTop: summary.top } : null
      })
      assert.ok(sections && sections.summaryTop >= sections.controlsBottom - 1, `report summary overlaps controls at ${width}px`)
      if (width >= 1280) {
        const headers = await page.locator('[data-report-dashboard] [data-slot="table"] thead th:visible').evaluateAll((nodes) => nodes.map((node) => {
          const box = node.getBoundingClientRect()
          return { left: box.left, right: box.right, width: box.width }
        }))
        assert.equal(headers.length, 9, `compact summary should expose nine columns at ${width}px`)
        for (const header of headers) assert.ok(header.width > 0 && header.right > header.left)
        const detailButtons = page.getByRole('button', { name: 'View Details', exact: true })
        assert.ok(await detailButtons.count() > 0, `desktop detail action should be available at ${width}px`)
      }
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.locator('#report-rows-per-page').selectOption('10')

  await selectReportPeriod("Specific Date")
  await page.locator('[aria-label="Specific date"]').fill("2026-10-01")
  assert.match(await summaryText(), /Records\s+1/)
  assert.match(await page.locator('[data-report-dashboard]').innerText(), /BK-PRINT-1/)
  assert.doesNotMatch(await page.locator('[data-report-dashboard]').innerText(), /BK-PRINT-2/)
  assert.match(await page.locator('[data-report-dashboard]').innerText(), /Daily Performance/)

  await selectReportPeriod("Specific Week")
  await page.locator('[aria-label="Day in specific week"]').fill("2026-10-15")
  assert.match(await summaryText(), /Records\s+1/)
  assert.match(await page.locator('[data-report-dashboard]').innerText(), /BK-PRINT-2/)
  assert.match(await page.locator('[data-report-dashboard]').innerText(), /Weekly Performance/)

  await selectReportPeriod("Specific Month")
  await selectFilterOption("Specific month", "Oct")
  await selectFilterOption("Specific year", "2026")
  assert.match(await summaryText(), /Records\s+2/)
  assert.match(await page.locator('[data-report-dashboard]').innerText(), /Daily Performance/)

  await selectReportPeriod("Specific Year")
  await selectFilterOption("Specific year", "2026")
  assert.match(await summaryText(), /Records\s+20/)
  assert.match(await page.locator('[data-report-dashboard]').innerText(), /Yearly Performance/)

  await selectReportPeriod("Custom Date Range")
  await page.locator('[aria-label="Custom range start date"]').fill("2026-09-01")
  await page.locator('[aria-label="Custom range end date"]').fill("2026-10-01")
  assert.match(await summaryText(), /Records\s+19/)
  assert.match(await page.locator('[data-report-dashboard]').innerText(), /Custom Period Performance/)
  await page.setViewportSize({ width: 320, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "custom period controls should not overflow a phone viewport")
  await page.setViewportSize({ width: 1440, height: 1000 })

  await selectReportPeriod("All Dates")
  await selectFilterOption("Booking Category", "Event Venues")
  await selectFilterOption("Venue / Office", "Main Hall")
  await selectFilterOption("Booking status filter", "Confirmed")
  assert.match(await summaryText(), /Records\s+10/)
  await page.getByRole("button", { name: "Reset Filters", exact: true }).click()

  await selectReportPeriod("Specific Month")
  await selectFilterOption("Specific month", "Oct")
  await selectFilterOption("Specific year", "2026")

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
  assert.equal(worksheet.getCell("A3").value, "Venue Booking Report")
   assert.equal(worksheet.getCell("A4").value, "Reporting Period: Oct 2026")
   assert.equal(worksheet.getCell("A6").value, "Active Filters: Reporting Period: Oct 2026")
  assert.equal(worksheet.getCell("A9").value, "BOOKING SUMMARY")
  assert.equal(worksheet.getCell("A15").value, "PAYMENTS & REFUNDS SUMMARY")
  assert.deepEqual(
    worksheet.getRow(23).values.slice(1),
    [
      "Booking ID", "Event Name", "Client", "Date", "Venue", "Booking Status", "Payment Status",
      "Total Booking Value", "Received Payments", "Verified Payments", "Outstanding Balance",
      "Refund Status", "Processed Refund", "Net Received Cash",
    ],
  )
  const excelSummary = new Map()
  for (let rowNumber = 9; rowNumber < 23; rowNumber++) {
    excelSummary.set(worksheet.getCell(rowNumber, 1).value, worksheet.getCell(rowNumber, 9).value)
  }
  assert.equal(excelSummary.get("TOTAL BOOKINGS"), 2)
  assert.equal(excelSummary.get("Total Booking Value"), 17500)
  assert.equal(excelSummary.get("Received Payments"), 5000)
  assert.equal(excelSummary.get("Processed Refunds"), 2000)
  assert.equal(excelSummary.get("NET RECEIVED CASH"), 3000)
  const excelRows = new Map()
  for (let rowNumber = 24; rowNumber <= worksheet.rowCount; rowNumber++) {
    excelRows.set(worksheet.getCell(rowNumber, 1).value, worksheet.getRow(rowNumber).values.slice(1))
  }
  assert.equal(excelRows.get("BK-PRINT-1")[7], 10000)
  assert.equal(excelRows.get("BK-PRINT-1")[8], 5000)
  assert.equal(excelRows.get("BK-PRINT-1")[12], 2000)
  assert.equal(excelRows.get("BK-PRINT-1")[13], 3000)

  await page.evaluate(() => {
    window.__reportPrintCalls = 0
    window.print = () => { window.__reportPrintCalls += 1 }
  })

  const printButton = page.getByRole("button", { name: "Print Report", exact: true })
  await page.setViewportSize({ width: 320, height: 568 })
  await printButton.click()
  const printDialog = page.locator("[data-report-print-options-dialog]")
  await printDialog.waitFor({ state: "visible" })
  const dialogBox = await printDialog.boundingBox()
  assert.ok(dialogBox && dialogBox.width <= 288 && dialogBox.x >= 0, "print dialog should fit the 320px viewport")
  assert.equal(await printDialog.getAttribute("role"), "dialog")
  assert.equal(await page.getByRole("dialog", { name: "Print Options", exact: true }).count(), 1)
  assert.equal(await printDialog.getByRole("radio").count(), 2, "print choices should expose two accessible radio controls")
  assert.equal(await printDialog.getByRole("radio", { name: /WITH Charts/ }).count(), 1)
  assert.equal(await printDialog.getByRole("radio", { name: /WITHOUT Charts/ }).count(), 1)
  assert.equal(
    await page.evaluate(() => Boolean(document.activeElement?.closest("[data-report-print-options-dialog]"))),
    true,
    "dialog focus should remain inside the print options dialog",
  )
  assert.equal(
    await printDialog.locator('[data-report-print-option="with-charts"] [data-slot="radio-group-item"]').getAttribute("data-state"),
    "checked",
    "print options should default to charts",
  )
  assert.equal(await printDialog.getByRole("button", { name: "Cancel", exact: true }).isVisible(), true)

  const reportUrlBeforePrintOptions = page.url()
   const selectedYearBeforeCancel = await page.locator('[aria-label="Specific year"]').innerText()
  await printDialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await printDialog.waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => window.__reportPrintCalls), 0, "cancel should not invoke browser printing")
   assert.equal(await page.locator('[aria-label="Specific year"]').innerText(), selectedYearBeforeCancel, "cancel should preserve filters")
  assert.equal(page.url(), reportUrlBeforePrintOptions, "print options should not navigate away from the report")

  await page.setViewportSize({ width: 1440, height: 1000 })
  await printButton.click()
  await printDialog.waitFor({ state: "visible" })
  await printDialog.locator('[data-report-print-option="without-charts"] [data-slot="radio-group-item"]').click()
  assert.equal(
    await printDialog.locator('[data-report-print-option="without-charts"] [data-slot="radio-group-item"]').getAttribute("data-state"),
    "checked",
  )
  await printDialog.getByRole("button", { name: "Print Report", exact: true }).click()
  await printDialog.waitFor({ state: "hidden" })
  await page.emulateMedia({ media: "print" })
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")))
  await page.locator('[data-report-print-report]').waitFor({ state: "visible" })

  const withoutChartsReport = page.locator('[data-report-print-report]')
  const withoutChartsText = await withoutChartsReport.innerText()
  const withoutChartsSummary = await page.locator('[data-report-print-summary]').innerText()
  const withoutChartsSelection = await withoutChartsReport.locator('[data-report-print-page="1"] [data-report-print-header-context]').innerText()
  const withoutChartsRows = await withoutChartsReport.locator('[data-report-print-table] tbody tr').allInnerTexts()
  assert.equal(await withoutChartsReport.getAttribute("data-report-print-mode"), "without-charts")
  assert.equal(await page.locator('[data-report-print-analytics]').count(), 0, "chart-free output should omit analytics")
  assert.equal(await withoutChartsReport.locator('[data-report-print-chart-card]').count(), 0, "chart-free output should not leave chart cards")
  assert.equal(withoutChartsRows.length, 2, "chart-free output should include every filtered record")
  assert.match(withoutChartsText, /Reporting Period: Oct 2026/)
  assert.doesNotMatch(withoutChartsText, /Applied Filters:|Filters Applied:|Office Room: Not applicable/i)
  assert.match(withoutChartsText, /Print Layout: Without Charts/)
  assert.match(withoutChartsText, /Total Booking Value/i)
  assert.match(withoutChartsText, /Received Payments/i)
  assert.match(withoutChartsText, /Net Received Cash/i)
  assert.match(withoutChartsText, /₱17,500\.00/)
  assert.match(withoutChartsText, /₱10,000\.00/)
  assert.match(withoutChartsText, /₱5,000\.00/)
  assert.match(withoutChartsText, /₱2,000\.00/)
  assert.match(withoutChartsText, /₱3,000\.00/)
  const withoutChartsPdf = await page.pdf({
    path: join(output, "report-without-charts.pdf"),
    format: "A4",
    landscape: true,
    printBackground: true,
  })
  assert.ok(withoutChartsPdf.length > 10_000, "chart-free print preview should produce a non-empty PDF")
  const withoutChartsLayout = await assertPrintDocumentLayout(page, "Admin")
  assert.equal(getPdfPageCount(withoutChartsPdf), withoutChartsLayout.pageCount, "chart-free PDF pages should match the controlled page count")
  assert.equal(withoutChartsLayout.pageCount, 2, "the filtered chart-free fixture should use two pages")

  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")))
  await page.emulateMedia({ media: "screen" })
  await printButton.click()
  await printDialog.waitFor({ state: "visible" })
  await printDialog.locator('[data-report-print-option="with-charts"] [data-slot="radio-group-item"]').click()
  await printDialog.getByRole("button", { name: "Print Report", exact: true }).click()
  await printDialog.waitFor({ state: "hidden" })
  await page.emulateMedia({ media: "print" })
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")))
  await page.locator('[data-report-print-report]').waitFor({ state: "visible" })

  const withChartsReport = page.locator('[data-report-print-report]')
  const withChartsText = await withChartsReport.innerText()
  const withChartsSummary = await page.locator('[data-report-print-summary]').innerText()
  const withChartsSelection = await withChartsReport.locator('[data-report-print-page="1"] [data-report-print-header-context]').innerText()
  const withChartsRows = await withChartsReport.locator('[data-report-print-table] tbody tr').allInnerTexts()
  assert.equal(await withChartsReport.getAttribute("data-report-print-mode"), "with-charts")
  assert.equal(await page.locator('[data-report-print-analytics]').count(), 1, "chart-inclusive output should include analytics")
  assert.equal(await page.locator('[data-report-print-chart-card]').count(), 4)
  assert.equal(withChartsRows.length, withoutChartsRows.length, "both modes should include the same filtered row count")
  assert.deepEqual(withChartsRows, withoutChartsRows, "both modes should include the same filtered table rows")
  assert.equal(withChartsSummary, withoutChartsSummary, "both modes should preserve identical financial summaries")
   assert.equal(
     withChartsSelection.replace(/\nPrint Layout: (?:With|Without) Charts$/, ""),
     withoutChartsSelection.replace(/\nPrint Layout: (?:With|Without) Charts$/, ""),
     "both modes should preserve identical report selection metadata",
   )
  assert.match(withChartsText, /Print Layout: With Charts/)
  assert.match(withChartsText, /VISUAL ANALYTICS/)
  assert.match(withChartsText, /Reporting Period: Oct 2026/)
  assert.doesNotMatch(withChartsText, /Financial Report/i)

  const withChartsPdf = await page.pdf({
    path: join(output, "report-with-charts.pdf"),
    format: "A4",
    landscape: true,
    printBackground: true,
  })
  assert.ok(withChartsPdf.length > 10_000, "chart-inclusive print preview should produce a non-empty PDF")
  const withChartsLayout = await assertPrintDocumentLayout(page, "Admin")
  assert.equal(getPdfPageCount(withChartsPdf), withChartsLayout.pageCount, "chart-inclusive PDF pages should match the controlled page count")
  assert.equal(withChartsLayout.pageCount, 5, "the filtered chart-inclusive fixture should use five pages")

  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")))
  await page.emulateMedia({ media: "screen" })
  await page.getByRole("button", { name: "Reset Filters", exact: true }).click()
  await page.getByRole("button", { name: "Print Report", exact: true }).click()
  await printDialog.waitFor({ state: "visible" })
  await printDialog.locator('[data-report-print-option="with-charts"] [data-slot="radio-group-item"]').click()
  await printDialog.getByRole("button", { name: "Print Report", exact: true }).click()
  await printDialog.waitFor({ state: "hidden" })
  await page.emulateMedia({ media: "print" })
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")))
  await page.locator('[data-report-print-report]').waitFor({ state: "visible" })
  const unpaginatedRows = await page.locator('[data-report-print-report] [data-report-print-table] tbody tr').allInnerTexts()
  assert.equal(unpaginatedRows.length, 20, "printing should use the full filtered dataset rather than the visible page")
  assert.match(unpaginatedRows.join("\n"), /BK-TABLE-12/)
  assert.match(unpaginatedRows.join("\n"), /Annual Stakeholder and Financial Planning Conference/)
  assert.match(unpaginatedRows.join("\n"), /Alexandra Benjamin de la Cruz and Partners/)

  const fullWithChartsPdf = await page.pdf({
    path: join(output, "report-full-with-charts.pdf"),
    format: "A4",
    landscape: true,
    printBackground: true,
  })
  assert.ok(fullWithChartsPdf.length > 10_000, "the multi-page chart-inclusive PDF should be non-empty")
  const fullLayout = await assertPrintDocumentLayout(page, "Admin")
  assert.equal(getPdfPageCount(fullWithChartsPdf), fullLayout.pageCount, "full PDF pages should match the controlled page count")
  assert.equal(fullLayout.pageCount, 7, "the large fixture should reproduce an approximately seven-page report")
  assert.deepEqual(
    fullLayout.details.filter((detail) => detail.tableHeadings > 0).map((detail) => detail.tableRows),
    [8, 8, 4],
    "controlled pagination should keep complete rows on each table page",
  )

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
      summaryHeading: read('[data-report-print-summary-section] h4'),
      tableHeading: read('[data-report-print-table] th'),
      tableValue: read('[data-report-print-table] td'),
      dashboardDisplay: getComputedStyle(document.querySelector('[data-report-dashboard]')).display,
    }
  })
  assert.equal(typography.report.color, "rgb(0, 0, 0)")
  assert.match(typography.report.family, /^Inter/)
  assert.equal(typography.bannerHeading.weight, "700")
   assert.equal(typography.summaryHeading.weight, "700")
   assert.equal(typography.summaryHeading.color, "rgb(15, 23, 42)")
  assert.equal(typography.tableHeading.weight, "700")
  assert.equal(typography.tableValue.weight, "400")
  assert.equal(typography.tableValue.color, "rgb(0, 0, 0)")
  assert.equal(typography.dashboardDisplay, "none")
  assert.equal(await page.evaluate(() => window.__reportPrintCalls), 3, "each confirmed print option should invoke browser printing once")

  const inspectPreparedBy = async (fixtureUser, expectedPreparedBy) => {
    await page.emulateMedia({ media: "screen" })
    await page.evaluate((user) => localStorage.setItem("__reportPrintFixtureUser", JSON.stringify(user)), fixtureUser)
    await page.reload()
    await page.locator('[data-report-dashboard]').waitFor({ state: "attached" })
    await page.getByRole("button", { name: "Print Report", exact: true }).click()
    const currentPrintDialog = page.locator("[data-report-print-options-dialog]")
    await currentPrintDialog.waitFor({ state: "visible" })
    await currentPrintDialog.getByRole("button", { name: "Print Report", exact: true }).click()
    await currentPrintDialog.waitFor({ state: "hidden" })
    await page.emulateMedia({ media: "print" })
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")))
    await page.locator('[data-report-print-report]').waitFor({ state: "visible" })
    await assertPrintDocumentLayout(page, expectedPreparedBy)
    const footerText = await page.locator('[data-report-print-footer]').allTextContents()
    footerText.forEach((text) => {
      assert.match(text, new RegExp(`Prepared By: ${expectedPreparedBy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
      assert.doesNotMatch(text, /Generated By:/)
      assert.doesNotMatch(text, /Fixture Client/)
    })
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")))
    await page.emulateMedia({ media: "screen" })
  }

  await inspectPreparedBy({ role: "staff", fullName: "Juan Dela Cruz", name: "Juan Dela Cruz", email: "staff@example.com", permissions: { reports: true } }, "Juan Dela Cruz")
  await inspectPreparedBy({ role: "staff", fullName: "", name: "", email: "staff@example.com", permissions: { reports: true } }, "Staff (name unavailable)")

  console.log(`Report print checks passed. PDF bytes: full charts ${fullWithChartsPdf.length}, filtered charts ${withChartsPdf.length}, without charts ${withoutChartsPdf.length}. Artifacts: ${output}`)
} finally {
  await browser?.close()
  await server.close()
}
