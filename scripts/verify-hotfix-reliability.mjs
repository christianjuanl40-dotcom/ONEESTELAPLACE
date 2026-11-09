/** Actual chat/notification providers and suggestion hook; local service fixtures only. */
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"
import { createServer } from "vite"
import { chromium } from "playwright"
import tailwindcss from "tailwindcss"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const output = await mkdtemp(join(process.env.HOTFIX_TEMP_DIR || tmpdir(), "one-estela-hotfix-"))
const modules = {
  state: `
    import {useSyncExternalStore} from 'react';
    let identity={id:localStorage.getItem('fixture-identity')||'NEW',role:'client',name:'Disposable Client'};
    const authListeners=new Set(); const listeners=new Set();
    const records=new Map(JSON.parse(localStorage.getItem('fixture-records')||'[]'));
    records.set('users/NEW',records.get('users/NEW')||{});
    records.set('chatSuggestionQuestions/publishedVersion',{revision:1});
    let ready=false;let writes=0;let subscriptions=0;
    const save=()=>localStorage.setItem('fixture-records',JSON.stringify([...records]));
    const document=(path,data)=>({id:path.split('/').at(-1),exists:()=>data!==undefined,data:()=>data});
    function snapshot(ref){
      if(ref.document)return document(ref.path,records.get(ref.path));
      let entries=[...records].filter(([path])=>path.startsWith(ref.path+'/'));
      for(const c of ref.constraints||[]){
        if(c.kind==='where')entries=entries.filter(([,data])=>c.operator==='in'?c.value.includes(data[c.field]):data[c.field]===c.value);
        if(c.kind==='orderBy')entries=entries.filter(([,data])=>data[c.field]!==undefined).sort((a,b)=>String(a[1][c.field]).localeCompare(String(b[1][c.field]))*(c.direction==='desc'?-1:1));
        if(c.kind==='limit')entries=entries.slice(0,c.value);
        if(c.kind==='limitToLast')entries=entries.slice(-c.value);
      }
      const docs=entries.map(([path,data])=>document(path,data));
      return {docs,size:docs.length,empty:!docs.length,forEach:fn=>docs.forEach(fn),metadata:{fromCache:!ready}};
    }
    const emit=()=>{save();for(const item of listeners)item.next(snapshot(item.ref))};
    export const useAuth=()=>({user:useSyncExternalStore(fn=>{authListeners.add(fn);return()=>authListeners.delete(fn)},()=>identity),isLoading:false});
    export const collection=(_,path)=>({path});export const doc=(_,collection,id)=>({path:collection+'/'+id,document:true});
    export const query=(ref,...constraints)=>({...ref,constraints});
    export const where=(field,operator,value)=>({kind:'where',field,operator,value});
    export const orderBy=(field,direction='asc')=>({kind:'orderBy',field,direction});
    export const limit=value=>({kind:'limit',value});export const limitToLast=value=>({kind:'limitToLast',value});
    export const startAfter=()=>({kind:'cursor'});export const endBefore=()=>({kind:'cursor'});
    export function onSnapshot(ref,options,next,error){if(typeof options==='function'){error=next;next=options}const item={ref,next,error};listeners.add(item);subscriptions++;queueMicrotask(()=>{if(listeners.has(item))next(snapshot(ref))});return()=>listeners.delete(item)}
    export const getDocs=async ref=>snapshot(ref);
    export const serverTimestamp=()=>new Date().toISOString();
    export const addDoc=async(ref,data)=>{const id='MSG-'+(++writes);records.set(ref.path+'/'+id,data);emit();return{id}};
    export const updateDoc=async(ref,data)=>{records.set(ref.path,{...records.get(ref.path),...data});emit()};
    export const runTransaction=async(_,fn)=>fn({get:async ref=>snapshot(ref),set:(ref,data)=>{writes++;records.set(ref.path,{...records.get(ref.path),...data});emit()}});
    const empty=[];export const useBookingData=()=>({bookings:empty,paymentRecords:empty,isLoading:false,dataError:null});
    window.fixture={ready(){ready=true;emit()},sync:emit,stats:()=>({writes,subscriptions,listeners:listeners.size,records:[...records]}),
      identity(id){if(id)localStorage.setItem('fixture-identity',id);else localStorage.removeItem('fixture-identity');identity=id?{id,role:'client',name:'Disposable Client'}:null;authListeners.forEach(fn=>fn())},
      put(path,data){records.set(path,data);emit()},
      failNotifications(code){for(const item of [...listeners])if(item.ref.path==='notifications')item.error({code,message:'Fixture failure'})},
      failChat(code){for(const item of [...listeners])if(item.ref.path==='chatMessages'&&(item.ref.constraints||[]).some(c=>c.kind==='orderBy'))item.error({code,message:'Fixture failure'})}
    };
  `,
  firebase: `export const db={};`,
  auth: `export {useAuth} from 'virtual:hotfix-state';`,
  booking: `export {useBookingData} from 'virtual:hotfix-state';`,
  firestore: `export {collection,doc,query,where,orderBy,limit,limitToLast,startAfter,endBefore,onSnapshot,getDocs,serverTimestamp,addDoc,updateDoc,runTransaction} from 'virtual:hotfix-state';`,
  token: `export const getAuthHeaders=async()=>({'Content-Type':'application/json'});`,
  entry: `
    import React,{useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';
    import {ChatProvider,useChat} from '@/src/modules/shared/contexts/chat-context';
    import {NotificationProvider,useNotifications} from '@/src/modules/shared/contexts/notification-context';
     import {useChatSuggestions} from '@/src/modules/shared/hooks/use-chat-suggestions';
     import {ChatSuggestionPills} from '@/src/modules/shared/components/chat-suggestion-pills';
     import {isHumanSupportReply} from '@/src/modules/shared/lib/chat-suggestions';
    import {ChatWelcome} from '@/src/modules/shared/components/chat-welcome';
    import {useAuth} from 'virtual:hotfix-state';import '@/app/globals.css';
    const h=React.createElement;
     function Chat(){const chat=useChat();const {user}=useAuth();const hasHumanSupportReply=chat.messages.some(isHumanSupportReply);const suggestionState=useChatSuggestions({visible:!!user,chatReady:chat.isChatLoaded,hasHumanSupportReply});
       useEffect(()=>{chat.loadChat();return chat.unloadChat},[chat.loadChat,chat.unloadChat]);
        const selectSuggestion=async suggestion=>{await chat.sendPredefinedQuestion(suggestion.id)};
       window.chatActions=chat;
        return h('section',{'aria-label':'Chat regression'},h('p',{'data-chat-ready':true},String(chat.isChatLoaded)),h('p',{'data-chat-error':true},chat.chatError),h(ChatWelcome,{ready:chat.isChatLoaded,empty:!chat.messages.length,error:chat.chatError}),h('div',{'data-messages':true},chat.messages.map(m=>h('p',{key:m.id},m.text))),h(ChatSuggestionPills,{suggestions:suggestionState.suggestions,bookingLabel:suggestionState.context?.bookingId?suggestionState.context.bookingLabel:undefined,onSelect:selectSuggestion,disabled:false}));
    }
    function App(){const [visible,setVisible]=useState(true);const notifications=useNotifications();window.notificationActions=notifications;
      return h('main',{className:'mx-auto max-w-4xl p-4'},h('button',{onClick:()=>setVisible(v=>!v)},'Toggle conversation'),visible&&h(Chat),h('section',{'aria-label':'Saved notifications'},h('p',{'data-notification-loading':true},String(notifications.isLoading)),h('p',{'data-notification-error':true},notifications.error),notifications.notifications.map(n=>h('article',{key:n.id},h('h2',null,n.title),h('p',null,n.message)))));
    }
    createRoot(document.getElementById('root')).render(h(ChatProvider,null,h(NotificationProvider,null,h(App))));
  `,
}
const mocks = [
  [/\/auth\/auth-context(?:\.tsx?)?$/, "auth"], [/\/client\/contexts\/booking-context(?:\.tsx?)?$/, "booking"],
  [/\/lib\/firebase(?:\.ts)?$/, "firebase"], [/^firebase\/firestore$/, "firestore"], [/\/lib\/auth-token(?:\.ts)?$/, "token"],
]
const server = await createServer({
  configFile: false, envFile: false, envDir: false, root, cacheDir: join(output, "vite-cache"), logLevel: "error",
  define: { "process.env.NEXT_PUBLIC_PERF_TRACE": JSON.stringify("0") }, server: { host: "127.0.0.1", port: 0 },
  resolve: { alias: { "@": root, "@shared": join(root, "src/modules/shared") } }, oxc: { jsx: { runtime: "automatic" } },
  css: { postcss: { plugins: [tailwindcss({ config: join(root, "tailwind.config.ts") })] } },
  optimizeDeps: { noDiscovery: true, include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"] },
  plugins: [{ name: "local-hotfix-fixtures", enforce: "pre", resolveId(source) {
    if (source.startsWith("virtual:hotfix-")) return `\0hotfix-${source.slice("virtual:hotfix-".length)}.tsx`
    const match = mocks.find(([pattern]) => pattern.test(source.replaceAll("\\", "/")))
    if (match) return `\0hotfix-${match[1]}.tsx`
  }, load(id) { const match = id.match(/^\0hotfix-(.+)\.tsx$/); if (match) return modules[match[1]] },
  configureServer(vite) { vite.middlewares.use(async (request, response, next) => {
    if (!request.url?.startsWith("/__hotfix")) return next()
    response.setHeader("Content-Type", "text/html")
    response.end(await vite.transformIndexHtml(request.url, '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--font-sans:Arial,sans-serif}</style></head><body><div id="root"></div><script type="module" src="/@id/__x00__hotfix-entry.tsx"></script></body></html>'))
  }) } }],
})

let browser
let checks = 0
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true, channel: process.env.PAYMENT_REVIEW_BROWSER_CHANNEL || undefined })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
   const errors = []
   let answerRequests = 0
  page.on("pageerror", (error) => errors.push(error.message))
  await page.route("**/*", (route) => {
    const url = route.request().url()
     if (url === `${origin}/api/chat-suggestions/published`) return route.fulfill({ json: { revision: 1, context: { kind: "no_booking", contextKey: "no-booking:1" }, questions: [] } })
     if (url === `${origin}/api/chat-suggestions/answer`) { answerRequests++; return route.fulfill({ status: 201, json: { questionMessageId: "FIXTURE-QUESTION", answerMessageId: "FIXTURE-ANSWER", automaticReplySent: true, alreadyProcessed: false } }) }
    return url.startsWith(origin) ? route.continue() : route.abort()
  })
  await page.goto(`${origin}/__hotfix`)
  await page.waitForFunction(() => window.fixture && window.chatActions)
  assert.equal(await page.locator('[aria-label="Welcome to chat support"]').count(), 0, "cache-only empty must not initialize a welcome")
  checks++
  await page.evaluate(() => window.fixture.ready())
  await page.getByRole("heading", { name: "Welcome to One Estela Place!" }).waitFor()
  await page.getByRole("button", { name: "How do I book a venue?" }).waitFor()
  await page.waitForFunction(() => window.fixture.stats().records.some(([path, data]) => path === "users/NEW" && data.chatSuggestionState?.lastShownAt))
   for (let index = 0; index < 5; index++) await page.evaluate(() => window.fixture.sync())
   assert.equal(await page.getByRole("button", { name: "How do I book a venue?" }).count(), 1, "own cooldown snapshot must not dismiss the displayed question")
   assert.equal(await page.evaluate(() => window.fixture.stats().records.filter(([path]) => path.startsWith('chatMessages/')).length), 0, "welcome and suggestion displays must not insert chat messages")
   for (const width of [320, 375, 768, 1024, 1280, 1440]) {
     await page.setViewportSize({ width, height: 900 })
     const suggestion = page.getByRole("button", { name: "How do I book a venue?" })
     const box = await suggestion.boundingBox()
     assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, `${width}px suggestion stays inside the chat surface`)
     assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px chat has no page overflow`)
     await page.screenshot({ path: join(output, `empty-chat-${width}.png`) })
   }
   await page.setViewportSize({ width: 1440, height: 900 })
   await page.getByRole("button", { name: "How do I book a venue?" }).click()
   assert.equal(answerRequests, 1, "selecting a predefined question reaches the existing answer endpoint")
    assert.equal(await page.getByRole("button", { name: "How do I book a venue?" }).count(), 1, "automated answers do not dismiss predefined questions")
   checks += 5
  await page.evaluate(() => { window.chatActions.loadChat(); window.chatActions.loadChat() })
  await page.waitForFunction(() => window.chatActions.isChatLoaded)
  assert.equal(await page.getByRole("heading", { name: "Welcome to One Estela Place!" }).count(), 1)
  checks++
  await page.evaluate(() => window.fixture.put('notifications/REMINDER', { type: 'balance_reminder', title: 'Remaining Balance Reminder', message: 'Please settle your saved balance.', userId: 'NEW', bookingId: 'BOOKING', createdAt: new Date().toISOString(), isRead: false, moduleRead: false, link: '/portal/payments?highlight=BOOKING' }))
  await page.getByRole("heading", { name: "Remaining Balance Reminder" }).waitFor()
  await page.reload()
  await page.waitForFunction(() => window.fixture && window.chatActions)
  await page.evaluate(() => window.fixture.ready())
  await page.getByRole("heading", { name: "Welcome to One Estela Place!" }).waitFor()
  await page.getByRole("heading", { name: "Remaining Balance Reminder" }).waitFor()
   assert.equal(await page.getByRole("button", { name: "How do I book a venue?" }).count(), 1, "a new session preserves suggestions until a human support reply")
  checks += 3
  await page.evaluate(() => window.fixture.identity(null))
  await page.waitForFunction(() => window.notificationActions.notifications.length === 0)
  await page.evaluate(() => window.fixture.identity('NEW'))
  await page.getByRole("heading", { name: "Remaining Balance Reminder" }).waitFor()
  await page.getByRole("heading", { name: "Welcome to One Estela Place!" }).waitFor()
  checks += 2
  await page.evaluate(() => window.fixture.put('chatMessages/EXISTING', { clientId: 'EXISTING', sender: 'admin', text: 'Existing conversation remains intact.', timestamp: '2026-11-01T00:00:00Z', isReadByClient: true }))
  await page.evaluate(() => window.fixture.identity('EXISTING'))
  await page.getByText("Existing conversation remains intact.", { exact: true }).waitFor()
  assert.equal(await page.getByRole("heading", { name: "Welcome to One Estela Place!" }).count(), 0)
  assert.equal(await page.getByRole("heading", { name: "Remaining Balance Reminder" }).count(), 0, "another client's inbox must not leak")
  checks += 2
  await page.evaluate(() => window.chatActions.sendMessage('Existing client reply', 'client', 'EXISTING', 'Fixture'))
  await page.getByText("Existing client reply", { exact: true }).waitFor()
  for (let index = 0; index < 3; index++) {
    await page.getByRole("button", { name: "Toggle conversation" }).click()
    await page.getByRole("button", { name: "Toggle conversation" }).click()
    await page.getByText("Existing client reply", { exact: true }).waitFor()
  }
  assert.equal(await page.getByText("Existing conversation remains intact.", { exact: true }).count(), 1)
  checks += 4
  await page.reload()
  await page.waitForFunction(() => window.fixture && window.chatActions)
  await page.evaluate(() => window.fixture.ready())
  await page.getByText("Existing client reply", { exact: true }).waitFor()
  await page.getByText("Existing conversation remains intact.", { exact: true }).waitFor()
  assert.equal(await page.getByRole("heading", { name: "Welcome to One Estela Place!" }).count(), 0)
  checks++
  await page.evaluate(() => window.fixture.failChat('failed-precondition'))
  await page.waitForFunction(() => window.chatActions.chatError?.includes('index'))
  await page.evaluate(() => window.chatActions.retryChat())
  await page.waitForFunction(() => window.chatActions.isChatLoaded && !window.chatActions.chatError)
  checks++
  await page.evaluate(() => window.fixture.failNotifications('failed-precondition'))
  await page.waitForFunction(() => window.notificationActions.error?.includes('index'))
  const before = await page.evaluate(() => window.fixture.stats().subscriptions)
  await page.evaluate(() => window.notificationActions.retryNotifications())
  await page.waitForFunction(() => !window.notificationActions.error)
  assert.equal(await page.evaluate(() => window.fixture.stats().subscriptions), before + 1, "retry uses only the canonical ordered inbox, no partial fallback")
  checks++
   for (const width of [320, 375, 768, 1024, 1280, 1440]) {
     await page.setViewportSize({ width, height: 900 })
     assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
     await page.screenshot({ path: join(output, `chat-history-${width}.png`) })
     checks++
   }
   assert.deepEqual(errors, [])
   const result = { checks, widths: [320, 375, 768, 1024, 1280, 1440], errors, serviceBoundary: "in-memory only; no live Auth/Firestore", artifacts: output }
  await writeFile(join(output, "results.json"), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser?.close()
  await server.close()
}
