/**
 * Local-only Chromium checks for the CMS venue, office, and virtual-tour tabs.
 * The actual tab components and shared Radix primitives are rendered with an
 * in-memory CMS context. No Firebase, CMS API, or production record is used.
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
const output = await mkdtemp(join(process.env.CMS_TEMP_DIR || tmpdir(), "one-estela-cms-"))
const modules = {
  state: `
    import {useSyncExternalStore} from 'react';
    let catalog={
      venues:[{id:'venue-1',name:'Grand Hall',capacity:'80-100 pax',price:15000,downPaymentPercentage:50,description:'Fixture venue',detailedDescription:'Fixture details',image:'',panoImage:'',catalogStatus:'published'}],
      offices:[{id:'office-1',name:'Executive Offices',capacity:'1-4 pax',price:12000,downPaymentPercentage:50,description:'Fixture office',detailedDescription:'Fixture details',image:'',panoImage:'',catalogStatus:'published',rooms:[{id:'room-1',name:'Room 1'},{id:'room-2',name:'Room 2'}]}]
    };
    const listeners=new Set();
    const emit=()=>listeners.forEach(listener=>listener());
    const replace=(type,id,patch)=>{catalog={...catalog,[type]:catalog[type].map(item=>item.id===id?{...item,...patch}:item)};window.fixture.updates.push({type,id,patch});emit()};
    const remove=(type,id)=>{catalog={...catalog,[type]:catalog[type].map(item=>item.id===id?{...item,isArchived:true}:item)};window.fixture.updates.push({type,id,archived:true});emit()};
    const updateRoom=(officeId,roomId,patch)=>{catalog={...catalog,offices:catalog.offices.map(office=>office.id===officeId?{...office,rooms:office.rooms.map(room=>room.id===roomId?{...room,...patch}:room)}:office)};window.fixture.updates.push({type:'room',id:roomId,patch});emit()};
    const addRoom=(officeId,room)=>{const id='room-'+(catalog.offices.find(office=>office.id===officeId)?.rooms.length+1);catalog={...catalog,offices:catalog.offices.map(office=>office.id===officeId?{...office,rooms:[...office.rooms,{...room,id}]}:office)};emit();return true};
    window.fixture={updates:[],toasts:[],catalog:()=>catalog};
    export function useCMS(){
      const current=useSyncExternalStore(listener=>{listeners.add(listener);return()=>listeners.delete(listener)},()=>catalog,()=>catalog);
      return {
        venues:current.venues.filter(item=>!item.isArchived), offices:current.offices.filter(item=>!item.isArchived),
        updateVenue:async(id,patch)=>{replace('venues',id,patch);return true}, addVenue:async(data)=>{catalog={...catalog,venues:[...catalog.venues,{...data,id:'venue-new'}]};emit();return true}, deleteVenue:id=>remove('venues',id),
        updateOffice:async(id,patch)=>{replace('offices',id,patch);return true}, addOffice:async(data)=>{catalog={...catalog,offices:[...catalog.offices,{...data,id:'office-new'}]};emit();return true}, deleteOffice:async(id)=>{remove('offices',id);return true},
        addRoomToOffice:async(officeId,room)=>addRoom(officeId,room), addRoomsToOffice:async(officeId,rooms)=>{for(const room of rooms)await addRoom(officeId,room);return true},
        updateRoomInOffice:async(officeId,roomId,patch)=>{updateRoom(officeId,roomId,patch);return true}, deleteRoomFromOffice:async()=>true,
        getOfficeRooms:officeId=>current.offices.find(office=>office.id===officeId)?.rooms||[],
      };
    }
  `,
  toast: `import { } from 'react';export const useToast=()=>({toast:value=>window.fixture.toasts.push(value)});`,
  imageUpload: `export const validateImageFile=()=>{};export const uploadCMSImage=async()=> 'data:image/png;base64,fixture';export const removeImage=async()=> '';`,
  entry: `
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {CMSVenuesTab} from '@/src/modules/admin/components/cms/cms-venues-tab';
    import {CMSOfficesTab} from '@/src/modules/admin/components/cms/cms-offices-tab';
    import {CMSVirtualTourTab} from '@/src/modules/admin/components/cms/cms-virtual-tour-tab';
    import '@/app/globals.css';
    function App(){
      const [tab,setTab]=useState('venues');
      const props={onNavigate:setTab};
      return React.createElement(React.Fragment,null,
        tab==='venues'?React.createElement(CMSVenuesTab,props):null,
        tab==='offices'?React.createElement(CMSOfficesTab,props):null,
        tab==='virtualTour'?React.createElement(CMSVirtualTourTab,props):null
      );
    }
    createRoot(document.getElementById('root')).render(React.createElement(App));
  `,
}

const mocks = [
  [/\/admin\/contexts\/cms-context(?:\.tsx)?$/, "state"],
  [/\/hooks\/use-toast(?:\.tsx?)?$/, "toast"],
  [/\/lib\/image-upload(?:\.tsx?)?$/, "imageUpload"],
]

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
      "@radix-ui/react-alert-dialog", "@radix-ui/react-dialog", "@radix-ui/react-label", "@radix-ui/react-slot", "@radix-ui/react-visually-hidden",
    ],
  },
  plugins: [{
    name: "local-cms-fixtures",
    enforce: "pre",
    resolveId(source) {
      if (source === "virtual:cms-entry") return "\0cms-entry.tsx"
      if (source.startsWith("virtual:cms-")) return `\0cms-${source.slice("virtual:cms-".length)}.tsx`
      const match = mocks.find(([pattern]) => pattern.test(source.replaceAll("\\", "/")))
      return match ? `\0cms-${match[1]}.tsx` : undefined
    },
    load(id) {
      const match = id.match(/^\0cms-(.+)\.tsx$/)
      return match ? modules[match[1]] : undefined
    },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/__cms")) return next()
        response.setHeader("Content-Type", "text/html")
        response.end(await vite.transformIndexHtml(request.url, '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__cms-entry.tsx"></script></body></html>'))
      })
    },
  }],
})

let browser
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true, channel: process.env.CMS_BROWSER_CHANNEL || undefined })
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
  const errors = []
  const refWarnings = []
  page.on("pageerror", (error) => errors.push(error.stack || error.message))
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") return
    const text = message.text()
    if (/Function components cannot be given refs/.test(text)) refWarnings.push(text)
    if (message.type() === "error") errors.push(text)
  })

  await page.goto(`${origin}/__cms`)
  await page.getByRole("heading", { name: "Event Venues", exact: true }).waitFor()
  const settle = async () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const assertNoPageOverflow = async (label) => {
    const metrics = await page.evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }))
    assert.ok(metrics.scrollWidth <= metrics.width + 1, `${label} has document horizontal overflow: ${JSON.stringify(metrics)}`)
    assert.ok(metrics.bodyScrollWidth <= metrics.width + 1, `${label} has body horizontal overflow: ${JSON.stringify(metrics)}`)
  }
  const assertDialogFits = async (label) => {
    const dialog = page.getByRole("dialog")
    const box = await dialog.boundingBox()
    assert.ok(box, `${label} dialog should be visible`)
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= page.viewportSize().width && box.y + box.height <= page.viewportSize().height, `${label} dialog should fit the viewport`)
    const overflow = await dialog.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }))
    assert.ok(overflow.scrollWidth <= overflow.clientWidth + 1, `${label} dialog should not have horizontal overflow`)
  }

  for (const viewport of [{ width: 320, height: 700 }, { width: 375, height: 800 }, { width: 768, height: 900 }, { width: 1024, height: 900 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport)
    await assertNoPageOverflow(`${viewport.width}px venue table`)
  }
  console.log("PASS venue table responsive overflow checks at 320/375/768/1024/1440px")

  const venueEdit = page.getByRole("button", { name: "Edit Grand Hall", exact: true })
  await venueEdit.click()
  await page.getByRole("dialog", { name: "Edit Venue", exact: true }).waitFor()
  await assertDialogFits("venue editor")
  assert.equal(await page.getByLabel("Name", { exact: true }).count(), 1)
  assert.equal(await page.getByRole("button", { name: "Close venue editor", exact: true }).count(), 1)
  await page.keyboard.press("Escape")
  await page.getByRole("dialog", { name: "Edit Venue", exact: true }).waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Edit Grand Hall", "venue dialog should restore focus to its opener")
  console.log("PASS venue edit dialog accessible name, labels, Escape, focus restoration, and viewport fit")

  await venueEdit.click()
  await page.getByRole("dialog", { name: "Edit Venue", exact: true }).waitFor()
  await page.getByRole("button", { name: "Close venue editor", exact: true }).click()
  await page.getByRole("button", { name: "Archive Grand Hall", exact: true }).click()
  await page.getByRole("alertdialog", { name: "Delete Venue?", exact: true }).waitFor()
  const cancelVenueDelete = page.getByRole("alertdialog", { name: "Delete Venue?", exact: true }).getByRole("button", { name: "Cancel", exact: true })
  await cancelVenueDelete.focus()
  await page.keyboard.press("Enter")
  await page.getByRole("alertdialog", { name: "Delete Venue?", exact: true }).waitFor({ state: "hidden" })
  await page.getByRole("button", { name: "Archive Grand Hall", exact: true }).click()
  await page.getByRole("alertdialog", { name: "Delete Venue?", exact: true }).getByRole("button", { name: "Delete", exact: true }).click()
  await page.getByText("No venues yet", { exact: true }).waitFor()
  console.log("PASS venue contextual archive action and keyboard-safe destructive confirmation")

  const sectionMenu = page.getByRole("button", { name: "Event Venues", exact: true })
  await sectionMenu.click()
  await page.getByRole("menuitem", { name: "Office Spaces", exact: true }).focus()
  await page.keyboard.press("Enter")
  await page.getByRole("heading", { name: "Office Spaces", exact: true }).waitFor()
  await page.getByRole("button", { name: "Edit Executive Offices", exact: true }).click()
  const officeDialog = page.getByRole("dialog", { name: "Edit Office", exact: true })
  await officeDialog.waitFor()
  await assertDialogFits("office editor")
  assert.equal(await page.getByRole("button", { name: "Edit Room 1", exact: true }).count(), 1)
  assert.equal(await page.getByRole("button", { name: "Archive Room 1", exact: true }).count(), 1)
  await page.getByRole("button", { name: "Edit Room 1", exact: true }).click()
  await page.locator("#office-room-name").fill("Room 1 Updated")
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await page.getByRole("button", { name: "Edit Room 1 Updated", exact: true }).waitFor()
  assert.ok((await page.evaluate(() => window.fixture.updates)).some((update) => update.type === "room" && update.id === "room-1"), "room edit should use the fixture mutation boundary")
  await page.keyboard.press("Escape")
  await officeDialog.waitFor({ state: "hidden" })
  console.log("PASS office table room edit/delete accessible names and keyboard operation")

  await page.getByRole("button", { name: "Office Spaces", exact: true }).click()
  await page.getByRole("menuitem", { name: "Virtual Tour", exact: true }).click()
  await page.getByRole("heading", { name: "Virtual Tour", exact: true }).waitFor()
  await assertNoPageOverflow("virtual tour table")
  await page.getByRole("button", { name: "Edit panorama for Executive Offices", exact: true }).click()
  const tourDialog = page.getByRole("dialog", { name: "Edit Panorama", exact: true })
  await tourDialog.waitFor()
  await assertDialogFits("virtual tour editor")
  assert.equal(await page.getByRole("button", { name: "Close panorama editor", exact: true }).count(), 1)
  await page.keyboard.press("Escape")
  await tourDialog.waitFor({ state: "hidden" })
  console.log("PASS virtual-tour navigation, table action name, dialog close, and responsive fit")

  assert.equal(blocked.length, 0, `CMS fixture attempted external requests: ${blocked.join(", ")}`)
  assert.equal(refWarnings.length, 0, `Radix ref warnings remain: ${refWarnings.join("\n")}`)
  assert.equal(errors.length, 0, `CMS browser errors: ${errors.join("\n")}`)
  await settle()
  console.log(`CMS browser checks passed. Artifacts: ${output}`)
} finally {
  await browser?.close()
  await server.close()
}
