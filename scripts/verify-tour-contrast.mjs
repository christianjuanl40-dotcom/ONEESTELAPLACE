/**
 * Focused local Chromium regression for the public Take a Tour card contrast.
 * The real TourButton is rendered with an in-memory CMS catalog. No Firebase,
 * CMS API, external panorama, or production record is used.
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
const output = await mkdtemp(join(process.env.TOUR_CONTRAST_TEMP_DIR || tmpdir(), "one-estela-tour-contrast-"))

const modules = {
  state: `
    const cmsData={
      venues:[
        {id:'venue-milestone',name:'The Milestone Event',capacity:'80–100 pax',description:'A premium event venue.',detailedDescription:'Venue details.',image:'/placeholder.jpg'},
        {id:'venue-garden',name:'Garden Pavilion',capacity:'30–50 pax',description:'A bright garden venue.',detailedDescription:'Garden details.',image:'/placeholder.jpg'}
      ],
      offices:[
        {id:'office-north',name:'North Wing Offices',capacity:'1–4 pax',description:'Private office rooms.',detailedDescription:'Office details.',image:'/placeholder.jpg'},
        {id:'office-south',name:'South Wing Offices',capacity:'5–8 pax',description:'Flexible office rooms.',detailedDescription:'South office details.',image:'/placeholder.jpg'}
      ]
    };
    export function useCMS(){ return {cmsData}; }
  `,
  entry: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {TourButton} from '@/src/modules/client/components/tour-button';
    import '@/app/globals.css';
    createRoot(document.getElementById('root')).render(
      React.createElement('main',{className:'oe-light-surface'},React.createElement(TourButton,null,'Take a Tour'))
    );
  `,
}

const mocks = [[/\/admin\/contexts\/cms-context(?:\.tsx)?$/, "state"]]

const server = await createServer({
  configFile: false,
  envFile: false,
  envDir: false,
  root,
  cacheDir: join(output, "vite-cache"),
  logLevel: "error",
  resolve: { alias: { "@": root, "@admin": join(root, "src/modules/admin"), "@shared": join(root, "src/modules/shared") } },
  server: { host: "127.0.0.1", port: 0, forwardConsole: false },
  oxc: { jsx: { runtime: "automatic" } },
  css: { postcss: { plugins: [tailwindcss({ config: join(root, "tailwind.config.ts") })] } },
  optimizeDeps: {
    noDiscovery: true,
    include: [
      "react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime",
      "lucide-react", "clsx", "tailwind-merge", "class-variance-authority",
      "@radix-ui/react-collapsible", "@radix-ui/react-dialog", "@radix-ui/react-slot", "@radix-ui/react-visually-hidden",
    ],
  },
  plugins: [{
    name: "local-tour-contrast-fixture",
    enforce: "pre",
    resolveId(source) {
      if (source === "virtual:tour-entry") return "\0tour-entry.tsx"
      const match = mocks.find(([pattern]) => pattern.test(source.replaceAll("\\", "/")))
      return match ? `\0tour-${match[1]}.tsx` : undefined
    },
    load(id) {
      const match = id.match(/^\0tour-(.+)\.tsx$/)
      return match ? modules[match[1]] : undefined
    },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/__tour-contrast")) return next()
        response.setHeader("Content-Type", "text/html")
        response.end(await vite.transformIndexHtml(request.url, '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__tour-entry.tsx"></script></body></html>'))
      })
    },
  }],
})

const contrastInfo = (element) => {
  const parse = (value) => {
    const match = value.match(/rgba?\(([^)]+)\)/)
    if (!match) return null
    const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()))
    if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) return null
    return { r: parts[0], g: parts[1], b: parts[2], a: Number.isFinite(parts[3]) ? parts[3] : 1 }
  }
  const composite = (foreground, background) => {
    const alpha = foreground.a
    return {
      r: foreground.r * alpha + background.r * (1 - alpha),
      g: foreground.g * alpha + background.g * (1 - alpha),
      b: foreground.b * alpha + background.b * (1 - alpha),
    }
  }
  const linear = (channel) => {
    const normalized = channel / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  const luminance = (color) => 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b)
  const foreground = parse(getComputedStyle(element).color)
  if (!foreground) throw new Error("element should have a computed foreground color")

  const ancestors = []
  for (let node = element.parentElement; node; node = node.parentElement) ancestors.unshift(node)
  let background = { r: 255, g: 255, b: 255 }
  for (const ancestor of ancestors) {
    const color = parse(getComputedStyle(ancestor).backgroundColor)
    if (color && color.a > 0) background = composite(color, background)
  }
  const foregroundLuminance = luminance(foreground)
  const backgroundLuminance = luminance(background)
  return {
    foreground: getComputedStyle(element).color,
    background: `rgb(${Math.round(background.r)}, ${Math.round(background.g)}, ${Math.round(background.b)})`,
    ratio: (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05),
  }
}

let browser
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true, channel: process.env.TOUR_CONTRAST_BROWSER_CHANNEL || undefined })
  const context = await browser.newContext({ locale: "en-US", timezoneId: "Asia/Manila", serviceWorkers: "block" })
  const blocked = []
  await context.route("**/*", (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === origin || ["data:", "blob:"].includes(url.protocol)) return route.continue()
    blocked.push(`${request.method()} ${url.origin}${url.pathname}`)
    return route.abort()
  })
  const page = await context.newPage({ viewport: { width: 1440, height: 900 } })
  await page.addInitScript(() => {
    window.pannellum = {
      viewer: () => ({
        on: (event, callback) => { if (event === "load") queueMicrotask(callback) },
        startAutoRotate: () => {},
        stopAutoRotate: () => {},
        destroy: () => {},
        getHfov: () => 100,
        setHfov: () => {},
        setPitch: () => {},
        setYaw: () => {},
      }),
    }
  })
  const errors = []
  page.on("pageerror", (error) => errors.push(error.stack || error.message))
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })

  await page.goto(`${origin}/__tour-contrast`)
  await page.getByRole("button", { name: "Take a Tour", exact: true }).click()
  await page.getByRole("dialog", { name: "360 Tour", exact: true }).waitFor()

  const assertReadable = async (locator, label, minimum = 4.5) => {
    const info = await locator.evaluate(contrastInfo)
    assert.ok(info.ratio >= minimum, `${label} contrast ${info.ratio.toFixed(2)}:1 is below ${minimum}:1 (${info.foreground} on ${info.background})`)
    return info
  }

  const assertCard = async (name, capacity, stateLabel) => {
    const card = page.locator(`button[aria-label="View details for ${name}"], button[aria-label="Hide details for ${name}"]`).first()
    await card.waitFor()
    const capacityText = card.getByText(capacity, { exact: true })
    await capacityText.waitFor()
    const capacityInfo = await assertReadable(capacityText, `${stateLabel} ${name} capacity`)
    const iconInfo = await assertReadable(capacityText.locator("svg"), `${stateLabel} ${name} capacity icon`, 3)
    assert.equal(iconInfo.foreground, capacityInfo.foreground, `${stateLabel} ${name} capacity icon should use the capacity text color`)
    await assertReadable(card.locator("p").first(), `${stateLabel} ${name} title`)
    await assertReadable(card.locator("span.text-orange-400"), `${stateLabel} ${name} details label`)
  }

  const assertTabStates = async (activeTab) => {
    const venuesTab = page.getByRole("button", { name: "Venues", exact: true })
    const officesTab = page.getByRole("button", { name: "Offices", exact: true })
    const active = activeTab === "venues" ? venuesTab : officesTab
    const inactive = activeTab === "venues" ? officesTab : venuesTab
    assert.equal(await active.getAttribute("aria-pressed"), "true")
    assert.equal(await inactive.getAttribute("aria-pressed"), "false")
    await assertReadable(active, `${activeTab} active tab`)
    await assertReadable(inactive, `${activeTab} inactive tab`)
  }

  for (const viewport of [
    { width: 320, height: 700 },
    { width: 375, height: 800 },
    { width: 768, height: 900 },
    { width: 1024, height: 900 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport)
    await assertTabStates("venues")
    await assertCard("The Milestone Event", "80–100 pax", `${viewport.width}px selected`)
    await assertCard("Garden Pavilion", "30–50 pax", `${viewport.width}px unselected`)

    const gardenCard = page.locator('button[aria-label="View details for Garden Pavilion"]')
    await gardenCard.hover()
    await assertCard("Garden Pavilion", "30–50 pax", `${viewport.width}px hovered`)
    await gardenCard.focus()
    await assertCard("Garden Pavilion", "30–50 pax", `${viewport.width}px focused`)

    const milestoneCard = page.locator('button[aria-label="View details for The Milestone Event"]')
    await milestoneCard.click()
    await page.locator(".space-description-content p").first().waitFor()
    await assertCard("The Milestone Event", "80–100 pax", `${viewport.width}px expanded`)
    await assertReadable(page.locator(".space-description-content p").first(), `${viewport.width}px expanded description`)

    await page.getByRole("button", { name: "Offices", exact: true }).click()
    await assertTabStates("offices")
    await assertCard("North Wing Offices", "1–4 pax", `${viewport.width}px office selected`)
    await assertCard("South Wing Offices", "5–8 pax", `${viewport.width}px office unselected`)
    await page.locator('button[aria-label="View details for North Wing Offices"]').click()
    await assertCard("North Wing Offices", "1–4 pax", `${viewport.width}px office expanded`)
    await assertReadable(page.locator(".space-description-content p").first(), `${viewport.width}px office description`)

    await page.getByRole("button", { name: "Venues", exact: true }).click()
  }

  const dialogBackground = await page.getByRole("dialog", { name: "360 Tour", exact: true }).evaluate((element) => getComputedStyle(element).backgroundColor)
  assert.notEqual(dialogBackground, "rgb(255, 255, 255)", "Take a Tour should retain its dark premium surface")
  assert.equal(blocked.length, 0, `tour fixture attempted external requests: ${blocked.join(", ")}`)
  assert.equal(errors.length, 0, `tour browser errors: ${errors.join("\n")}`)
  console.log("PASS Take a Tour venue/office foreground contrast, tab states, card states, and responsive widths at 320/375/768/1024/1440px")
  console.log(`Tour contrast browser checks passed. Artifacts: ${output}`)
} finally {
  await browser?.close()
  await server.close()
}
