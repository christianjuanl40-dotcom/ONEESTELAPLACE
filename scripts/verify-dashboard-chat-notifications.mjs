/**
 * Local-only Chromium coverage for Phase 4 dashboard, chat, and notification
 * surfaces. Firebase, API, image, and navigation boundaries are deterministic
 * in-memory fixtures; no credentials, production services, or remote writes are used.
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
const output = await mkdtemp(join(process.env.PHASE4_TEMP_DIR || tmpdir(), "one-estela-phase4-"))

const modules = {
  state: `
    import {useSyncExternalStore} from 'react';
    const clientId='CLIENT-1';
    const baseMessages=[
      {id:'MSG-1',clientId,clientName:'Fixture Client',sender:'admin',senderId:'ADMIN',senderName:'Support',text:'Welcome to support.',content:'Welcome to support.',timestamp:'2026-05-14T16:30:00.000Z',isRead:true,isReadByClient:false},
      {id:'MSG-2',clientId,clientName:'Fixture Client',sender:'admin',senderId:'ADMIN',senderName:'Support',text:'We can help with your reservation.',content:'We can help with your reservation.',timestamp:'2026-05-15T01:00:00.000Z',isRead:true,isReadByClient:false},
      {id:'MSG-3',clientId,clientName:'Fixture Client',sender:'client',senderId:clientId,senderName:'Fixture Client',text:'Thank you.',content:'Thank you.',timestamp:'2026-05-15T02:00:00.000Z',isRead:true,isReadByClient:true},
      ...Array.from({length:24},(_,index)=>({id:'HISTORY-'+index,clientId,clientName:'Fixture Client',sender:index%2?'admin':'client',senderId:index%2?'ADMIN':clientId,senderName:index%2?'Support':'Fixture Client',text:'History message '+index+' with enough content to exercise the bounded chat scroller.',content:'History message '+index+' with enough content to exercise the bounded chat scroller.',timestamp:new Date(Date.UTC(2026,4,15,3,index)).toISOString(),isRead:index%2===0,isReadByClient:index%2===1}))
    ];
     const makeInitialSnapshot=()=>({
       messages:baseMessages,
       conversationIndex:[],
       hasOlderMessages:false,
       olderPageLoaded:false,
       unreadMessages:null,
       unreadMessagesIsBounded:false,
       chatLoaded:true,
       chatError:null,
      bookings:[{id:'BOOK-1',userId:clientId,status:'confirmed',bookingStatus:'Confirmed',eventName:'Fixture Reservation',venue:'Grand Hall',date:'2099-06-01',totalPrice:10000,totalAmount:10000,paymentType:'downpayment',selectedDownpaymentAmount:5000,createdAt:'2026-05-01T00:00:00.000Z'}],
      paymentRecords:[
        {id:'PAY-VERIFIED',bookingId:'BOOK-1',status:'Verified',amount:2000,submittedAt:'2026-05-01T01:00:00.000Z'},
        {id:'PAY-PENDING',bookingId:'BOOK-1',status:'For Review',amount:3000,submittedAt:'2026-05-02T01:00:00.000Z'}
      ],
      notifications:[
        {id:'NOTIF-1',type:'booking_approved',title:'Booking approved',message:'Your fixture reservation is confirmed.',bookingId:'BOOK-1',userId:clientId,isRead:false,moduleRead:false,createdAt:'2026-05-15T04:05:00.000Z',link:'/portal/bookings'},
        {id:'NOTIF-2',type:'balance_reminder',title:'Invalid destination fixture',message:'This record has no safe route.',bookingId:'BOOK-1',userId:clientId,isRead:true,moduleRead:true,createdAt:'2026-05-14T04:05:00.000Z',link:'javascript:blocked'}
      ],
       notificationError:null,
       notificationLoading:false,
       dataError:null,
       dataErrors:{},
       isLoading:false,
       sendFailure:false,
       notificationReadFailure:false,
       lastSent:null,
       navigation:[]
    });
    let snapshot=makeInitialSnapshot();
    const listeners=new Set();
    const publish=patch=>{snapshot={...snapshot,...patch};listeners.forEach(listener=>listener())};
    export const getState=()=>snapshot;
    export const subscribe=listener=>{listeners.add(listener);return()=>listeners.delete(listener)};
    export const send=async(text,role,clientIdArg)=>{if(snapshot.sendFailure){publish({sendFailure:false,lastSent:null});throw new Error('Fixture message write failed')};const id='SENT-'+Date.now();const message={id,clientId:clientIdArg||clientId,sender:role==='admin'?'admin':'client',senderId:role==='admin'?'ADMIN':clientIdArg||clientId,senderName:role==='admin'?'Support':'Fixture Client',text,content:text,timestamp:new Date().toISOString(),isRead:role==='admin',isReadByClient:role!=='admin'};snapshot.lastSent=message;publish({messages:[...snapshot.messages,message]});};
    window.fixture={
      snapshot:()=>snapshot,
      update:publish,
      reset(){snapshot=makeInitialSnapshot();this.navigation.length=0;listeners.forEach(listener=>listener())},
      failNextSend(){publish({sendFailure:true,lastSent:null})},
      failNextNotificationRead(){publish({notificationReadFailure:true})},
      setDataFailure(source,error){publish({isLoading:false,dataError:error,dataErrors:{[source]:error}})},
      beginDataRetry(){publish({isLoading:true,dataError:null,dataErrors:{}})},
      resolveDataRetry(){publish({isLoading:false,dataError:null,dataErrors:{}})},
      appendIncoming(){const index=snapshot.messages.length;send('Incoming message '+index,'admin',clientId)},
       setChatError(error){publish({chatError:error,chatLoaded:!error})},
       enableOlderHistory(){publish({hasOlderMessages:true,olderPageLoaded:false})},
       loadOlder(){if(snapshot.olderPageLoaded)return;const older=[{id:'OLDER-1',clientId,clientName:'Fixture Client',sender:'admin',senderId:'ADMIN',senderName:'Support',text:'Older paginated message',content:'Older paginated message',timestamp:'2026-05-14T12:00:00.000Z',isRead:true,isReadByClient:true},{id:'LEGACY-1',clientId,clientName:'Fixture Client',sender:'client',senderId:clientId,senderName:'Fixture Client',text:'Legacy message without a reliable timestamp',content:'Legacy message without a reliable timestamp',timestamp:null,isRead:true,isReadByClient:true}];publish({messages:[...older,...snapshot.messages],hasOlderMessages:false,olderPageLoaded:true})},
       setUnreadBounded(){publish({unreadMessages:500,unreadMessagesIsBounded:true})},
      setNotificationError(error){publish({notificationError:error,notificationLoading:false})},
      navigation:[],
      lastSent:()=>snapshot.lastSent,
      noExternalWrites:[]
    };
  `,
  auth: `
     const params=new URLSearchParams(location.search);const role=params.get('role')||'client';const account=params.get('account')||'CLIENT-1';
     export const useAuth=()=>({user:{id:role==='admin'?'ADMIN':account,role,name:role==='admin'?'Fixture Admin':'Fixture Client',permissions:{chat:true,dashboard:true,bookings:true,payments:true}},isLoading:false,initializationError:null});
  `,
  chat: `
    import {useSyncExternalStore} from 'react';import {getState,subscribe,send} from 'virtual:phase4-state';
     const actions={loadChat:()=>{},unloadChat:()=>{},loadOlderMessages:async()=>window.fixture.loadOlder(),retryChat:()=>window.fixture.update({chatError:null,chatLoaded:true}),markAsRead:clientId=>{const state=getState();window.fixture.update({messages:state.messages.map(message=>message.clientId===clientId&&message.sender==='client'?{...message,isRead:true}:message)})},markAsReadByClient:clientId=>{const state=getState();window.fixture.update({messages:state.messages.map(message=>message.clientId===clientId&&message.sender==='admin'?{...message,isReadByClient:true}:message)})},sendMessage:(text,role,clientId)=>send(text,role,clientId),sendPredefinedQuestion:async()=>{},getChatHistory:()=>getState().messages,getUnreadCount:()=>getState().messages.filter(message=>(message.sender==='client'||message.sender==='user')&&!message.isRead).length,clearNotifications:()=>{},markAdminAsRead:()=>{},toggleChat:()=>{},startTyping:()=>{},stopTyping:()=>{}};
     export const useChat=()=>{const state=useSyncExternalStore(subscribe,getState,getState);const admin= new URLSearchParams(location.search).get('role')==='admin';const computedUnread=state.messages.filter(message=>admin?message.sender==='client'&&!message.isRead:message.sender==='admin'&&!message.isReadByClient).length;return {messages:state.messages,conversationIndex:state.conversationIndex,activeConversationId:admin?'CLIENT-1':'CLIENT-1',typingIndicators:[],userStatuses:{},isConnected:true,isOpen:false,currentClientId:admin?null:'CLIENT-1',isChatLoaded:state.chatLoaded,isChatLoading:false,chatError:state.chatError,unreadError:null,newMessageNotifications:[],unreadMessages:state.unreadMessages ?? computedUnread,unreadMessagesIsBounded:state.unreadMessagesIsBounded,hasOlderMessages:state.hasOlderMessages,isLoadingOlder:false,...actions};};
  `,
  booking: `
    import {useSyncExternalStore} from 'react';import {getState,subscribe} from 'virtual:phase4-state';
      export function useBookingData(){const state=useSyncExternalStore(subscribe,getState,getState);return {bookings:state.bookings,paymentRecords:state.paymentRecords,officeRentals:[],maintenanceRecords:[],maintenanceDates:[],isLoading:state.isLoading,dataError:state.dataError,dataErrors:state.dataErrors,maintenanceError:null,isMaintenanceLoading:false,retryData:()=>window.fixture.beginDataRetry(),getUserBookings:uid=>state.bookings.filter(booking=>booking.userId===uid),_registerDataNeed:()=>{}};}
    export function useBookings(){return useBookingData()}
    export const calculateOfficeEndDate=(startDate)=>startDate;
  `,
  cms: `
    const cmsData={venues:[{id:'venue.A',name:'Fixture Hall',price:10000,capacity:'50',description:'Fixture event venue',image:'/placeholder.jpg'}],offices:[{id:'office.A',name:'Fixture Office',price:5000,rooms:[{id:'room.A',name:'Room A'}]}],faqs:[],pastClientBookings:[],homepage:{}};
    export const useCMS=()=>({cmsData,offices:cmsData.offices,getOfficeRooms:id=>cmsData.offices.find(item=>item.id===id)?.rooms||[]});
  `,
  notifications: `
    import {useSyncExternalStore} from 'react';import {getState,subscribe} from 'virtual:phase4-state';
     export const useNotifications=()=>{const state=useSyncExternalStore(subscribe,getState,getState);return {notifications:state.notifications,unreadCount:state.notifications.filter(item=>!item.isRead).length,moduleUnreadCount:state.notifications.filter(item=>!item.moduleRead).length,isLoading:state.notificationLoading,error:state.notificationError,retryNotifications:()=>window.fixture.update({notificationError:null,notificationLoading:false}),markAsRead:async id=>{const previous=getState().notifications;if(state.notificationReadFailure){window.fixture.update({notifications:previous.map(item=>item.id===id?{...item,isRead:true,moduleRead:true}:item),notificationReadFailure:false});await Promise.resolve();window.fixture.update({notifications:previous,notificationError:'Fixture notification read failed'});return}window.fixture.update({notifications:previous.map(item=>item.id===id?{...item,isRead:true,moduleRead:true}:item)})},markAllAsRead:async()=>window.fixture.update({notifications:getState().notifications.map(item=>({...item,isRead:true,moduleRead:true}))}),markByBookingId:async()=>{}}};
  `,
  suggestions: `export const useChatSuggestions=()=>({suggestions:[],context:null,isLoading:false,error:null,dismiss:()=>{}});`,
  toast: `export const useToast=()=>({toast:value=>{window.fixture.lastToast=value}});`,
  navigation: `export const useRouter=()=>({push:value=>{window.fixture.navigation.push(value)},replace:()=>{}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);`,
   link: `import React from 'react';const Link=React.forwardRef(function Link({href,children,...props},ref){return React.createElement('a',{href,...props,ref},children)});export default Link`,
  firebase: `export const db={};export const auth={currentUser:null};`,
   firestore: `export const collection=()=>({});export const query=()=>({});export const where=()=>({});export const orderBy=()=>({});export const limit=()=>({});export const doc=()=>({});export const onSnapshot=(_,next)=>{queueMicrotask(()=>next({size:0,docs:[],forEach:()=>{}}));return()=>{}};export const updateDoc=async()=>{};export const getDocs=async()=>({docs:[],forEach:()=>{}});export const addDoc=async()=>({id:'LOCAL'});export const serverTimestamp=()=>null;export const runTransaction=async()=>{};`,
  adminQueue: `export const buildPaymentReviewQueue=()=>[];export const DashboardPaymentReviewQueueModal=()=>null;`,
  adminBooking: `export const ApproveCancellationConfirmModal=()=>null;export const ApproveModificationConfirmModal=()=>null;export const BalanceReminderModal=()=>null;export const BookingDetailsModal=()=>null;export const ContractSigningConfirmModal=()=>null;export const DeclineCancellationModal=()=>null;export const DeclineModificationModal=()=>null;export const MarkCompletedConfirmModal=()=>null;export const RecordOnsitePaymentModal=()=>null;`,
  modify: `export const ModifyBookingDialog=()=>null;`,
  entry: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
     import ClientDashboard from '@/app/portal/page';import ClientChat from '@/app/portal/chat/page';import {ClientChatWidget} from '@/src/modules/shared/components/chat-widget';import AdminChat from '@/app/(admin)/dashboard/chat/page';import AdminDashboard from '@/app/(admin)/dashboard/page';import {NotificationDropdown} from '@/src/modules/shared/components/notification-dropdown';import 'virtual:phase4-state';import '@/app/globals.css';
    function Notifications(){const [open,setOpen]=useState(false);return React.createElement('div',{className:'p-4'},React.createElement('button',{type:'button','aria-label':'Notifications',onClick:()=>setOpen(value=>!value)},'Open notifications'),React.createElement(NotificationDropdown,{open,onClose:()=>setOpen(false)}))}
     function App(){const view=new URLSearchParams(location.search).get('view');if(view==='dashboard')return React.createElement(ClientDashboard);if(view==='admin-dashboard')return React.createElement(AdminDashboard);if(view==='admin-chat')return React.createElement(AdminChat);if(view==='client-widget')return React.createElement(ClientChatWidget);if(view==='notifications')return React.createElement(Notifications);return React.createElement(ClientChat);}
    createRoot(document.getElementById('root')).render(React.createElement(App));
  `,
}

const mocks = [
  [/^virtual:phase4-state$/, "state"],
  [/\/auth\/auth-context(?:\.tsx?)?$/, "auth"],
  [/\/contexts\/chat-context(?:\.tsx?)?$/, "chat"],
  [/\/client\/contexts\/booking-context(?:\.tsx?)?$/, "booking"],
  [/\/admin\/contexts\/cms-context(?:\.tsx?)?$/, "cms"],
  [/\/contexts\/notification-context(?:\.tsx?)?$/, "notifications"],
  [/\/hooks\/use-chat-suggestions(?:\.tsx?)?$/, "suggestions"],
  [/\/hooks\/use-toast(?:\.tsx?)?$/, "toast"],
  [/^next\/navigation$/, "navigation"],
  [/^next\/link$/, "link"],
  [/\/lib\/firebase(?:\.ts)?$/, "firebase"],
  [/^firebase\/firestore$/, "firestore"],
  [/\/admin\/components\/dashboard-payment-review-queue(?:\.tsx?)?$/, "adminQueue"],
  [/\/admin\/components\/booking-management-page(?:\.tsx?)?$/, "adminBooking"],
  [/\/admin\/components\/modify-booking-dialog(?:\.tsx?)?$/, "modify"],
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
      "react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react",
      "clsx", "tailwind-merge", "class-variance-authority", "@radix-ui/react-tooltip", "@radix-ui/react-slot",
    ],
  },
  plugins: [{
    name: "local-phase4-fixtures",
    enforce: "pre",
    resolveId(source) {
      if (source.startsWith("virtual:phase4-")) return `\0phase4-${source.slice("virtual:phase4-".length)}.tsx`
      const match = mocks.find(([pattern]) => pattern.test(source.replaceAll("\\", "/")))
      return match ? `\0phase4-${match[1]}.tsx` : undefined
    },
    load(id) {
      return modules[id.match(/^\0phase4-(.+)\.tsx$/)?.[1]]
    },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/__phase4")) return next()
        response.setHeader("Content-Type", "text/html")
        response.end(await vite.transformIndexHtml(request.url, '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__phase4-entry.tsx"></script></body></html>'))
      })
    },
  }],
})

let browser
const passed = []
const errors = []
const blocked = []
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true, channel: process.env.PHASE4_BROWSER_CHANNEL || undefined })
  const context = await browser.newContext({ locale: "en-US", timezoneId: "Asia/Manila", serviceWorkers: "block" })
  await context.route("**/*", (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === origin || ["data:", "blob:"].includes(url.protocol)) return route.continue()
    blocked.push(`${request.method()} ${url.origin}${url.pathname}`)
    return route.abort()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on("pageerror", (error) => errors.push(error.message))
   page.on("console", (message) => {
     if (message.type() !== "error") return
     const text = message.text()
     if (text.includes("Fixture message write failed") || text.includes("[ClientChat] message send failed")) return
     errors.push(text)
   })

  const check = async (name, run) => {
    await run()
    passed.push(name)
    console.log(`PASS ${name}`)
  }
   const goto = async (view, role = "client", account = "CLIENT-1") => {
     await page.goto(`${origin}/__phase4?view=${view}&role=${role}&account=${account}`)
     await page.waitForTimeout(100)
   }
   const waitForPaint = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  await check("client dashboard removes Payment Overview and keeps recent activity and transactions navigation", async () => {
    await goto("dashboard")
    const dashboardHeading = page.getByRole("heading", { name: "Dashboard", exact: true })
    await dashboardHeading.waitFor()
    assert.match(await dashboardHeading.getAttribute("class") || "", /\bsr-only\b/)
    assert.equal(await page.locator('header[aria-label="Dashboard toolbar"]').count(), 1)
    assert.equal(await page.getByText("Payment Overview", { exact: true }).count(), 0)
    assert.equal(await page.getByText("Pending submissions are shown separately and do not count as received payments.", { exact: true }).count(), 0)
    await page.getByRole('heading', {name:'Recent Payments',exact:true}).waitFor()
    assert.equal(await page.getByRole('link', {name:'Manage',exact:true}).getAttribute('href'), '/portal/payments')
    assert.equal(await page.locator('.oe-page-kicker, .oe-page-description').count(), 0)
    for (const width of [320,375,768,1024,1440]) {
      await page.setViewportSize({width,height:720})
      await waitForPaint()
      const title=await page.getByRole('heading',{name:'Dashboard',exact:true}).boundingBox()
      const action=await page.getByRole('button',{name:'New Booking',exact:true}).boundingBox()
      assert.ok(title.x+title.width<=width && action.x+action.width<=width)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    }
   })

   await check("successful empty dashboard reads keep the empty activity state without the removed overview", async () => {
     await page.evaluate(() => window.fixture.update({ bookings: [], paymentRecords: [], dataError: null, dataErrors: {}, isLoading: false }))
     await page.getByText("No payments yet.", { exact: true }).waitFor()
     assert.equal(await page.getByText("Payment Overview", { exact: true }).count(), 0)
     assert.equal(await page.getByRole("alert").count(), 0)
     await page.evaluate(() => window.fixture.reset())
   })

   await check("client booking read failure hides financial totals and recovers only after retry", async () => {
     await page.evaluate(() => window.fixture.setDataFailure("bookings", "Fixture booking read failed."))
     await page.getByRole("alert").getByText("Financial information unavailable", { exact: true }).waitFor()
     assert.equal(await page.getByText("₱0.00", { exact: true }).count(), 0)
     assert.equal(await page.getByRole("button", { name: "Retry dashboard data", exact: true }).count(), 1)
     await page.getByRole("button", { name: "Retry dashboard data", exact: true }).click()
     await page.getByRole("status").waitFor()
     assert.equal(await page.getByText("Payment Overview", { exact: true }).count(), 0)
     await page.evaluate(() => window.fixture.resolveDataRetry())
     await page.getByRole('heading', {name:'Recent Payments',exact:true}).waitFor()
     assert.equal(await page.getByText("Payment Overview", { exact: true }).count(), 0)
   })

   await check("client payment read failure does not render a partial aggregate", async () => {
     await page.evaluate(() => window.fixture.setDataFailure("payments", "Fixture payment read failed."))
     await page.getByRole("alert").getByText("Financial information unavailable", { exact: true }).waitFor()
     assert.equal(await page.getByText("Fixture Reservation", { exact: true }).count(), 0)
     assert.equal(await page.getByText("₱0.00", { exact: true }).count(), 0)
     await page.getByRole("button", { name: "Retry dashboard data", exact: true }).click()
     await page.getByRole("status").waitFor()
     await page.evaluate(() => window.fixture.resolveDataRetry())
     await page.getByRole('heading', {name:'Recent Payments',exact:true}).waitFor()
   })

   await check("account switching does not expose the previous client's financial data", async () => {
     await page.evaluate(() => window.fixture.reset())
     await goto("dashboard", "client", "CLIENT-2")
     await page.getByText("No payments yet.", { exact: true }).waitFor()
     assert.equal(await page.getByText("Fixture Reservation", { exact: true }).count(), 0)
     assert.equal(await page.getByText("Payment Overview", { exact: true }).count(), 0)
   })

    await check("admin combined and permission-denied reads fail closed", async () => {
      await page.evaluate(() => window.fixture.reset())
      await goto("admin-dashboard", "admin")
      await page.getByRole("heading", { name: "Recent Bookings", exact: true }).waitFor()
      await page.getByRole("heading", { name: "Needs Attention", exact: true }).waitFor()
      await page.getByText("Total Records", { exact: true }).waitFor()
      assert.equal(await page.getByRole("link", { name: "View All", exact: true }).getAttribute("href"), "/dashboard/bookings")
      assert.equal(await page.getByText("Payment position", { exact: true }).count(), 0)
      assert.equal(await page.getByText("Credited", { exact: true }).count(), 0)
      assert.equal(await page.getByText("Pending verification", { exact: true }).count(), 0)
      assert.equal(await page.getByText("Outstanding", { exact: true }).count(), 0)
      assert.equal(await page.getByText("Credited amounts use the canonical payment ledger; pending submissions are not counted as received.", { exact: true }).count(), 0)
      for (const width of [320, 375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 720 })
        await waitForPaint()
        const metrics = await page.evaluate(() => {
          const content = document.querySelector("h1.sr-only")?.parentElement
          const contentBottom = content ? content.getBoundingClientRect().bottom + window.scrollY : 0
          return {
            width: window.innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            pageBottomGap: Math.max(0, document.documentElement.scrollHeight - contentBottom),
          }
        })
        assert.ok(metrics.scrollWidth <= metrics.width + 1, `admin dashboard has horizontal overflow at ${width}px`)
        assert.ok(metrics.pageBottomGap < 240, `admin dashboard leaves excessive bottom space at ${width}px: ${metrics.pageBottomGap}px`)
      }
      await page.evaluate(() => window.fixture.update({
       dataError: "Bookings and Payments could not be authorized for this account.",
       dataErrors: { bookings: "Bookings could not be authorized.", payments: "Payments could not be authorized." },
       isLoading: false,
     }))
     await page.getByRole("alert").getByText("Financial information unavailable", { exact: true }).waitFor()
     assert.equal(await page.getByText("₱0", { exact: true }).count(), 0)
     assert.equal(await page.getByText("Fixture Reservation", { exact: true }).count(), 0)
     await page.getByRole("button", { name: "Retry dashboard data", exact: true }).click()
    await page.getByRole("status").waitFor()
    await page.evaluate(() => window.fixture.resolveDataRetry())
    const dashboardHeading = page.getByRole("heading", { name: "Dashboard", exact: true })
    await dashboardHeading.waitFor()
    assert.match(await dashboardHeading.getAttribute("class") || "", /\bsr-only\b/)
    assert.equal(await page.locator('.oe-page-kicker, .oe-page-description').count(), 0)
     assert.equal(await page.getByText("₱10,000", { exact: true }).count() > 0, true)
   })

   await check("dashboard unavailable state remains readable and contained at required widths", async () => {
     await page.evaluate(() => window.fixture.reset())
     await goto("dashboard")
     await page.evaluate(() => window.fixture.setDataFailure("payments", "Fixture payment outage."))
     await page.getByRole("alert").getByText("Financial information unavailable", { exact: true }).waitFor()
     for (const width of [320, 375, 768, 1024, 1440]) {
       await page.setViewportSize({ width, height: 720 })
       await waitForPaint()
       const metrics = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }))
       assert.ok(metrics.scrollWidth <= metrics.width + 1, `dashboard error has horizontal overflow at ${width}px`)
     }
     assert.equal(await page.getByRole("button", { name: "Retry dashboard data", exact: true }).count(), 1)
     await page.evaluate(() => window.fixture.reset())
   })

   await check("client chat groups messages and exposes Manila timestamps", async () => {
     await page.evaluate(() => window.fixture.reset())
     await goto("client-chat")
    await page.getByRole("heading", { name: "Chat Support", exact: true }).waitFor()
    // The first two support messages share a Manila day/sender group, so the
    // sender label appears once for that pair instead of once per message.
    assert.equal(await page.getByText("Support", { exact: true }).count(), 13)
    assert.equal(await page.getByText("May 15, 2026", { exact: true }).count(), 1)
    assert.ok((await page.locator("time").count()) >= 3)
     assert.equal(await page.getByRole("textbox", { name: "Message support", exact: true }).count(), 1)
   })

   await check("chat loads older pages without duplicates and preserves legacy visibility", async () => {
     await page.evaluate(() => window.fixture.enableOlderHistory())
     const messageList = page.locator("div.relative.flex-1.overflow-y-auto").first()
     await page.getByRole("button", { name: "Load older messages", exact: true }).waitFor()
     await messageList.evaluate((element) => { element.scrollTop = Math.min(48, element.scrollHeight); element.dispatchEvent(new Event("scroll", { bubbles: true })) })
     const before = await messageList.evaluate((element) => ({ scrollTop: element.scrollTop, scrollHeight: element.scrollHeight }))
     await page.getByRole("button", { name: "Load older messages", exact: true }).click()
     await page.getByText("Older paginated message", { exact: true }).waitFor()
     await page.getByText("Legacy message without a reliable timestamp", { exact: true }).waitFor()
     assert.equal(await page.getByText("Older paginated message", { exact: true }).count(), 1)
     assert.equal(await page.getByText("Legacy message without a reliable timestamp", { exact: true }).count(), 1)
     const after = await messageList.evaluate((element) => ({ scrollTop: element.scrollTop, scrollHeight: element.scrollHeight }))
     assert.ok(after.scrollHeight > before.scrollHeight)
     assert.ok(after.scrollTop > before.scrollTop, JSON.stringify({ before, after }))
     assert.equal(await page.getByRole("button", { name: "Load older messages", exact: true }).count(), 0)
   })

   await check("bounded unread counts are presented as 500+", async () => {
     await page.evaluate(() => window.fixture.reset())
     await goto("client-widget")
     await page.evaluate(() => window.fixture.setUnreadBounded())
     await page.getByRole("button", { name: "Open chat support, 500+ unread messages", exact: true }).waitFor()
     await goto("client-chat")
   })

  await check("client composer keeps Shift+Enter and sends on Enter", async () => {
    const composer = page.getByRole("textbox", { name: "Message support", exact: true })
    await composer.fill("First line")
    await composer.press("Shift+Enter")
    await composer.type("Second line")
    assert.equal(await composer.inputValue(), "First line\nSecond line")
    await composer.press("Enter")
    await page.waitForFunction(() => window.fixture.lastSent()?.text === "First line\nSecond line")
     assert.equal(await composer.inputValue(), "")
   })

   await check("chat send failure gives feedback without persisting a phantom message", async () => {
     await page.evaluate(() => window.fixture.reset())
     await goto("client-chat")
     const composer = page.getByRole("textbox", { name: "Message support", exact: true })
     const message = "Fixture failed message"
     await page.evaluate(() => window.fixture.failNextSend())
     await composer.fill(message)
     await composer.press("Enter")
     await page.waitForFunction(() => window.fixture.lastToast?.title === "Message not sent")
     assert.equal(await page.evaluate((text) => window.fixture.snapshot().messages.some((item) => item.text === text), message), false)
     assert.equal(await page.evaluate(() => window.fixture.lastSent()), null)
     await composer.fill(message)
     await composer.press("Enter")
     await page.waitForFunction((text) => window.fixture.lastSent()?.text === text, message)
     assert.equal(await page.evaluate((text) => window.fixture.snapshot().messages.filter((item) => item.text === text).length, message), 1)
   })

  await check("incoming messages preserve an older reading position until jump-to-latest", async () => {
    const messageList = page.locator("div.relative.flex-1.overflow-y-auto").first()
    await messageList.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll", { bubbles: true })) })
    await page.evaluate(() => window.fixture.appendIncoming())
    await page.getByText(/Incoming message/, { exact: false }).last().waitFor()
    assert.ok((await messageList.evaluate((element) => element.scrollTop)) < 80)
    const jump = page.getByRole("button", { name: "Jump to latest messages", exact: true }).last()
    await jump.click()
    await page.waitForTimeout(500)
    const afterJump = await messageList.evaluate((element) => ({ scrollHeight: element.scrollHeight, scrollTop: element.scrollTop, clientHeight: element.clientHeight }))
    assert.ok(afterJump.scrollHeight - afterJump.scrollTop - afterJump.clientHeight <= 100, JSON.stringify(afterJump))
  })

   await check("admin chat keeps conversation selection and send behavior keyboard accessible", async () => {
     await page.evaluate(() => window.fixture.reset())
     await goto("admin-chat", "admin")
    await page.getByRole("heading", { name: "Messages", exact: true }).waitFor()
    const client = page.getByRole("button", { name: /Fixture Client/ }).first()
    await client.click()
    const reply = page.getByRole("textbox", { name: "Reply to Fixture Client", exact: true })
    await reply.fill("Admin response")
    await reply.press("Enter")
    await page.waitForFunction(() => window.fixture.lastSent()?.text === "Admin response")
  })

   await check("notifications distinguish unread state and safely ignore invalid destinations", async () => {
     await page.evaluate(() => window.fixture.reset())
     await goto("notifications")
    await page.getByRole("button", { name: "Notifications", exact: true }).click()
    await page.getByRole("dialog", { name: "Notifications" }).waitFor()
    assert.equal(await page.getByText("Booking approved", { exact: true }).count(), 1)
    const invalid = page.getByRole("button", { name: /Invalid destination fixture/ })
    await invalid.click()
    assert.equal(await page.evaluate(() => window.fixture.navigation.length), 0)
     await page.evaluate(() => window.fixture.setNotificationError("Fixture notification outage"))
     await page.getByRole("button", { name: "Notifications", exact: true }).click()
     await page.getByRole("alert").getByText("Fixture notification outage", { exact: true }).waitFor()
     await page.getByRole("button", { name: "Retry notifications", exact: true }).click()
   })

   await check("notification read failure rolls back optimistic state and preserves unread count", async () => {
     await page.evaluate(() => window.fixture.reset())
     await goto("notifications")
     await page.getByRole("button", { name: "Notifications", exact: true }).click()
     await page.getByRole("dialog", { name: "Notifications" }).waitFor()
     await page.evaluate(() => window.fixture.failNextNotificationRead())
     await page.getByRole("button", { name: /Booking approved/ }).click()
     await page.getByRole("button", { name: "Notifications", exact: true }).click()
     await page.getByRole("alert").getByText("Fixture notification read failed", { exact: true }).waitFor()
     const notification = await page.evaluate(() => window.fixture.snapshot().notifications.find((item) => item.id === "NOTIF-1"))
     assert.equal(notification.isRead, false)
     assert.equal(notification.moduleRead, false)
     assert.equal(await page.evaluate(() => window.fixture.snapshot().notifications.filter((item) => !item.isRead).length), 1)
     await page.getByRole("button", { name: "Retry notifications", exact: true }).click()
     assert.equal(await page.getByRole("alert").count(), 0)
   })

  await check("dashboard and chat avoid page-level horizontal overflow at required widths", async () => {
    for (const view of ["dashboard", "admin-dashboard", "client-chat"]) {
      await goto(view, view === 'admin-dashboard' ? 'admin' : 'client')
      for (const width of [320, 375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 720 })
        await waitForPaint()
        const metrics = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }))
        assert.ok(metrics.scrollWidth <= metrics.width + 1, `${view} has horizontal overflow at ${width}px`)
         if (view.endsWith('dashboard')) {
           const heading = page.getByRole('heading',{name:'Dashboard',exact:true})
           assert.equal(await heading.count(),1)
           assert.match(await heading.getAttribute('class') || '', /\bsr-only\b/)
           if (view === 'admin-dashboard') {
             assert.equal(await page.getByRole('heading', { name: 'Recent Bookings', exact: true }).count(), 1)
             assert.equal(await page.getByRole('heading', { name: 'Needs Attention', exact: true }).count(), 1)
             assert.equal(await page.getByText('Total Records', { exact: true }).count(), 1)
             assert.equal(await page.getByText('Payment position', { exact: true }).count(), 0)
             assert.equal(await page.getByText('Credited', { exact: true }).count(), 0)
             assert.equal(await page.getByText('Pending verification', { exact: true }).count(), 0)
             assert.equal(await page.getByText('Outstanding', { exact: true }).count(), 0)
           }
           assert.equal(await page.locator('.oe-page-kicker, .oe-page-description').count(),0)
        }
      }
    }
  })

  if (blocked.length > 0) throw new Error(`Fixture attempted external requests: ${blocked.join(", ")}`)
  if (errors.length > 0) throw new Error(`Browser runtime errors: ${errors.join(" | ")}`)
  console.log(`Dashboard/chat/notification browser checks passed (${passed.length} scenarios). Local fixtures only. Artifacts: ${output}`)
} finally {
  await browser?.close()
  await server.close()
}
