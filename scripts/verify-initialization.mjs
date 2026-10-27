/** Real AuthProvider, BookingProvider, protected layouts, login dialog and
 * availability hooks. Only identity/database/network service boundaries are local
 * fixtures. --baseline replays the committed auth code to demonstrate its race.
 */
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import { createServer, transformWithOxc } from "vite"
import { chromium } from "playwright"
import tailwindcss from "tailwindcss"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const output = await mkdtemp(join(process.env.INITIALIZATION_TEMP_DIR || tmpdir(), "initialization-"))
const baselineArgument = process.argv.find(argument => argument === "--baseline" || argument.startsWith("--baseline="))
const baseline = Boolean(baselineArgument)
const baselineRef = baselineArgument?.split("=")[1] || "HEAD"
const modules = {
  state: `
    import {useSyncExternalStore} from 'react';
    const params=new URLSearchParams(location.search), subscribers=new Set(), profilePending=[], streams=new Set(), retired=[];
    const identity=uid=>({uid,email:uid.toLowerCase()+'@example.test',displayName:'Fixture '+uid,providerData:[],getIdToken:async()=>('fixture-token-'+uid)});
    const initial=params.get('returning');
    export const auth={currentUser:initial?identity(initial):null,authStateReady:()=>Promise.resolve()};
    const profiles={A:{role:'client'},B:{role:'client'},Admin:{role:'admin'},Staff:{role:'staff',permissions:{dashboard:true,payments:true}}};
    const routeListeners=new Set(); let path=params.get('path')||'/';
    export const router={replace(next){window.fixture.routes.push(next);path=next;routeListeners.forEach(fn=>fn())},push(next){this.replace(next)},prefetch(){}};
    export const usePathname=()=>useSyncExternalStore(fn=>{routeListeners.add(fn);return()=>routeListeners.delete(fn)},()=>path);
    export const useRouter=()=>router,useSearchParams=()=>params;
    export const db={};
    const rows={bookings:['A','B'].map(uid=>({id:'BOOK-'+uid,userId:uid,bookingCategory:'venue',venueId:'VENUE',spaceId:'VENUE',
      status:'pending',bookingStatus:'Pending',eventName:'Fixture '+uid,totalPrice:1000,paymentType:'downpayment',selectedDownpaymentAmount:500,createdAt:'2099-01-01'})),
      payments:['A','B'].map(uid=>({id:'PAY-'+uid,customerId:uid,bookingId:'BOOK-'+uid,amount:500,status:'Verified',submittedAt:'2099-01-01'})),maintenanceRecords:[],officeRentals:[]};
    const snapshot=(ref,cache=false)=>{
      const data=(rows[ref.path]||[]).filter(row=>(ref.filters||[]).every(([key,,value])=>row[key]===value));
      const docs=(cache?[]:data).map(row=>({id:row.id,data:()=>structuredClone(row)}));
      return {docs,size:docs.length,metadata:{fromCache:cache},forEach:fn=>docs.forEach(fn),docChanges:()=>docs.map(doc=>({type:'added',doc}))};
    };
    export const forbidden=()=>{window.fixture.unexpected.push('Unexpected service/write');throw Error('Unexpected service/write')};
    export function onAuthStateChanged(_,next){subscribers.add(next);queueMicrotask(()=>{if(subscribers.has(next))next(auth.currentUser)});return()=>subscribers.delete(next)};
    export function signInWithEmailAndPassword(_,email){const uid=Object.keys(profiles).find(uid=>uid.toLowerCase()===email.split('@')[0]);if(!uid)throw Error('Unknown fixture identity');window.fixture.emitAuth(uid);return Promise.resolve({user:auth.currentUser})};
    export const signOut=async()=>window.fixture.emitAuth(null);
    export function getProfile(ref,source){
      window.fixture.profileReads.push({uid:ref.id,source});
      if(window.fixture.profileFailure)return Promise.reject(Object.assign(new Error('Fixture profile unavailable'),{code:window.fixture.profileFailure}));
      return new Promise((resolve,reject)=>profilePending.push({uid:ref.id,resolve,reject}));
    }
    export function onSnapshot(ref,options,next,error){
      if(typeof options==='function'){error=next;next=options}
      const stream={ref,next,error,uid:auth.currentUser?.uid};streams.add(stream);window.fixture.starts.push({path:ref.path,filters:ref.filters});
      queueMicrotask(()=>{if(streams.has(stream)){
        if((window.fixture.datasetFailures[ref.path]||0)>0){window.fixture.datasetFailures[ref.path]--;error({code:'unavailable'});return}
        next(snapshot(ref,window.fixture.cacheOnly));
      }});
      return()=>{streams.delete(stream);retired.push(stream);window.fixture.stops++};
    }
    export const getDocs=async ref=>{window.fixture.extraReads.push(ref.path);return snapshot(ref)};
    window.fixture={profileReads:[],extraReads:[],starts:[],stops:0,routes:[],toasts:[],unexpected:[],requests:[],profiles,profileFailure:null,datasetFailures:{},cacheOnly:false,currentUid:()=>auth.currentUser?.uid,
      emitAuth(uid){auth.currentUser=uid?identity(uid):null;subscribers.forEach(fn=>fn(auth.currentUser))},
      pendingProfiles:()=>profilePending.map(item=>item.uid),
      releaseProfile(uid){const selected=profilePending.filter(item=>item.uid===uid);for(const item of selected){profilePending.splice(profilePending.indexOf(item),1);item.resolve({exists:()=>!!profiles[uid],data:()=>({fullName:'Fixture '+uid,status:'active',createdAt:'2099-01-01',...profiles[uid]})})}},
      emitData(){for(const stream of streams)stream.next(snapshot(stream.ref))},
      emitRetired(){for(const stream of retired)stream.next(snapshot(stream.ref))},
      activeStreams:()=>[...streams].map(stream=>({path:stream.ref.path,uid:stream.uid})),
    };
    export const toast=value=>window.fixture.toasts.push(value);
    const nativeFetch=window.fetch.bind(window),pendingHttp=[];
    window.fixture.httpPending=()=>pendingHttp.length;
    window.fixture.finishHttp=()=>pendingHttp.splice(0).forEach(item=>item());
    window.fetch=async(input,options={})=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(url.pathname==='/api/availability'){
        const values=Object.fromEntries(url.searchParams);const entry={uid:auth.currentUser?.uid,values,aborted:false};window.fixture.requests.push(entry);
        options.signal?.addEventListener('abort',()=>entry.aborted=true,{once:true});
        if(window.fixture.deferHttp)await new Promise(resolve=>pendingHttp.push(resolve));
        if(window.fixture.failHttp){window.fixture.failHttp=false;return new Response(JSON.stringify({error:'Fixture availability unavailable'}),{status:500})}
        const dates={};for(let day=new Date(values.from+'T00:00:00Z');day<=new Date(values.to+'T00:00:00Z');day.setUTCDate(day.getUTCDate()+1))dates[day.toISOString().slice(0,10)]={status:values.spaceId==='blocked'?'full':'available',availableSlots:[],occupiedIntervals:[]};
        return new Response(JSON.stringify({space:{category:values.category,venueId:values.venueId,officeId:values.officeId,spaceId:values.spaceId},dates}),{status:200});
      }
      if(url.origin!==location.origin||url.pathname.startsWith('/api/'))return forbidden();
      return nativeFetch(input,options);
    };
  `,
  firebase: `export {auth,db} from 'virtual:init-state'`,
  firebaseAuth: `export {onAuthStateChanged,signInWithEmailAndPassword,signOut,forbidden as createUserWithEmailAndPassword,forbidden as reauthenticateWithCredential,forbidden as reload} from 'virtual:init-state';export const EmailAuthProvider={credential:()=>({})}`,
  firestore: `import {getProfile} from 'virtual:init-state';export {onSnapshot,getDocs,forbidden as setDoc,forbidden as updateDoc,forbidden as writeBatch,forbidden as runTransaction} from 'virtual:init-state';
    export const doc=(_,collection,id)=>({path:collection,id}),collection=(_,path)=>({path}),where=(...args)=>args,orderBy=()=>({}),limit=()=>({}),query=(ref,...filters)=>({...ref,filters:filters.filter(Array.isArray)}),
      getDoc=ref=>getProfile(ref,'cache-default'),getDocFromServer=ref=>getProfile(ref,'server');`,
  navigation: `export {useRouter,usePathname,useSearchParams} from 'virtual:init-state'`,
  toast: `export {toast} from 'virtual:init-state';import {toast} from 'virtual:init-state';export const useToast=()=>({toast})`,
  notifications: `const value={notifications:[],unreadCount:0,markByBookingId:()=>{}};export const useNotifications=()=>value`,
  notificationService: `export {forbidden as createNotification} from 'virtual:init-state'`,
  chat: `const value={unreadMessages:0};export const useChat=()=>value`,
  staff: `export const StaffProvider=({children})=>children`,
  widgets: `export const ClientChatWidget=()=>null,NotificationDropdown=()=>null,ForgotPasswordDialog=()=>null`,
  link: `export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`,
  image: `export default function Image({priority,...props}){return <img {...props}/>} `,
  entry: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {AuthProvider,useAuth} from '@/src/modules/shared/auth/auth-context';
    import {BookingProvider,useBookingData,useBookings} from '@/src/modules/client/contexts/booking-context';
    import {LoginDialog} from '@/src/modules/shared/auth/login-dialog';
    import ClientLayout from '@/app/portal/layout';import AdminLayout from '@/app/(admin)/layout';
    import {useSpaceAvailability} from '@/src/modules/shared/hooks/use-space-availability';
    import {usePathname} from 'virtual:init-state';import '@/app/globals.css';
    function Observe(){const auth=useAuth(),data=useBookings();window.fixture.authContext=auth;window.fixture.data=data;
      return <output data-testid="session">{JSON.stringify({uid:auth.user?.id||null,loading:auth.isLoading,authLoading:auth.authLoading,profileLoading:auth.profileLoading,error:auth.initializationError})}</output>}
    function Extra(){useBookingData({bookings:true});return null}
    function Calendar(){const [state,setState]=useState({month:0,room:'one',render:0});window.fixture.changeCalendar=patch=>setState(current=>({...current,...patch}));
      const space={category:'office',venueId:'OFFICE',officeId:'OFFICE',spaceId:state.room,name:'Stable resource',catalog:{irrelevant:state.render}};
      const first=useSpaceAvailability(true,space,new Date(2030,state.month,1),'','6_months');
      const second=useSpaceAvailability(true,{...space},new Date(2030,state.month,1),'','6_months');window.fixture.calendar=first;
      return <output data-testid="calendar">{JSON.stringify({loading:first.loading,error:first.error,days:Object.keys(first.days),secondLoading:second.loading})}</output>}
    function Page(){const data=useBookingData({bookings:true,payments:true});const [extra,setExtra]=useState(false);return <>
      <output data-testid="data">{JSON.stringify({loading:data.isLoading,books:data.bookings.map(row=>row.id),payments:data.paymentRecords.map(row=>row.id),error:data.dataError})}</output>
      <button onClick={()=>setExtra(value=>!value)}>Toggle extra subscriber</button>{extra&&<Extra/>}
      {location.search.includes('calendar')&&<Calendar/>}</>}
    function App(){const path=usePathname();return <>{<Observe/>}{path==='/'?<LoginDialog/>:path.startsWith('/dashboard')?<AdminLayout><Page/></AdminLayout>:<ClientLayout><Page/></ClientLayout>}</>}
    createRoot(document.getElementById('root')).render(<AuthProvider><BookingProvider><App/></BookingProvider></AuthProvider>);
  `,
}
if (baseline) modules.baselineAuth = execFileSync("git", ["show", `${baselineRef}:src/modules/shared/auth/auth-context.tsx`], { cwd: root, encoding: "utf8" })
const mocks = [
  [/\/lib\/firebase(?:\.ts)?$/, "firebase"], [/^firebase\/auth$/, "firebaseAuth"], [/^firebase\/firestore$/, "firestore"],
  [/^next\/navigation$/, "navigation"], [/^next\/link$/, "link"], [/^next\/image$/, "image"],
  [/\/hooks\/use-toast(?:\.tsx?)?$/, "toast"], [/\/contexts\/notification-context(?:\.tsx)?$/, "notifications"],
  [/\/lib\/notifications(?:\.ts)?$/, "notificationService"], [/\/contexts\/chat-context(?:\.tsx)?$/, "chat"],
  [/\/contexts\/staff-context(?:\.tsx)?$/, "staff"], [/\/(chat-widget|notification-dropdown|forgot-password-dialog)(?:\.tsx)?$/, "widgets"],
  ...(baseline ? [[/(?:\/auth\/|^\.\/)auth-context(?:\.tsx)?$/, "baselineAuth"]] : []),
]
const server = await createServer({ configFile: false, envFile: false, envDir: false, root, cacheDir: join(output, "vite-cache"), logLevel: "error",
  define: { "process.env.NEXT_PUBLIC_PERF_TRACE": JSON.stringify("0") }, server: { host: "127.0.0.1", port: 0, forwardConsole: false },
  resolve: { alias: { "@": root, "@shared": join(root, "src/modules/shared") } }, oxc: { jsx: { runtime: "automatic" } },
  css: { postcss: { plugins: [tailwindcss({ config: join(root, "tailwind.config.ts") })] } },
  optimizeDeps: { noDiscovery: true, include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react", "clsx", "tailwind-merge", "class-variance-authority", "@radix-ui/react-dialog", "@radix-ui/react-slot", "@radix-ui/react-label"] },
  plugins: [{ name: "local-initialization-fixtures", enforce: "pre", resolveId(source) {
    if (source.startsWith("virtual:init-")) return `\0init-${source.slice("virtual:init-".length)}.tsx`
    const match=mocks.find(([pattern])=>pattern.test(source.replaceAll("\\","/")));if(match)return `\0init-${match[1]}.tsx`
    if (/^(firebase|firebase-admin)(\/|$)/.test(source)) throw Error(`Unstubbed service: ${source}`)
  }, load(id) { return modules[id.match(/^\0init-(.+)\.tsx$/)?.[1]] },
  transform(code,id) { if(id.startsWith('\0init-'))return transformWithOxc(code,'initialization-fixture.tsx',{jsx:{runtime:'automatic'}}) },
  configureServer(vite) {
    vite.middlewares.use(async(req,res,next)=>{if(!req.url?.startsWith('/__initialization'))return next();res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--font-sans:Arial,sans-serif}</style></head><body><div id="root"></div><script type="module" src="/@id/__x00__init-entry.tsx"></script></body></html>'))})
  } }],
})
let browser
const evidence=[], logs=[]
try {
  await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`
  browser=await chromium.launch({headless:true,channel:process.env.PAYMENT_REVIEW_BROWSER_CHANNEL||undefined})
  const page=await browser.newPage({viewport:{width:1280,height:800}})
  page.on('pageerror',error=>logs.push({type:'runtime',message:error.message}))
  page.on('console',message=>{if(['error','warning'].includes(message.type())||message.text().startsWith('[PERF]'))logs.push({type:message.type(),message:message.text()})})
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort())
  const open=async(query='')=>{await page.goto(`${origin}/__initialization${query}`);await page.waitForFunction(()=>!!window.fixture?.authContext)}
  const data=()=>page.getByTestId('data').textContent().then(JSON.parse)
  const waitReady=()=>page.waitForFunction(()=>window.fixture.data&&!window.fixture.data.isLoading&&window.fixture.data.bookings.length>0)
  const signIn=async(uid)=>{await page.getByRole('button',{name:'Login',exact:true}).click();await page.getByLabel('Email Address',{exact:true}).fill(uid.toLowerCase()+'@example.test');await page.getByLabel('Password',{exact:true}).fill('fixture-password');await page.getByRole('button',{name:'Sign In',exact:true}).click();await page.waitForFunction(()=>window.fixture.pendingProfiles().length>0)}

  await open();await signIn('A')
  const reads=await page.evaluate(()=>window.fixture.profileReads)
  console.log(JSON.stringify({scenario:'fresh-login',profileReads:reads.length,sources:reads.map(read=>read.source),baseline}))
  evidence.push({scenario:'fresh-login-before-profile',reads})
  if(baseline){
    if(reads.length>1){
      console.log('REPRODUCED: baseline login and auth listener issue competing profile reads.');
      await page.evaluate(()=>window.fixture.emitAuth('B'))
      await page.waitForFunction(()=>window.fixture.pendingProfiles().includes('B'))
      await page.evaluate(()=>window.fixture.releaseProfile('B'))
      await page.waitForFunction(()=>window.fixture.authContext.user?.id==='B')
      await page.evaluate(()=>window.fixture.releaseProfile('A'))
      await page.waitForFunction(()=>window.fixture.authContext.user?.id==='A')
      evidence.push(await page.evaluate(()=>({scenario:'obsolete-profile-overwrite',appProfileUid:window.fixture.authContext.user.id,actualSignedInUid:window.fixture.currentUid()})))
      console.log('REPRODUCED: late profile A overwrites initialized profile B while Firebase remains signed in as B.');
    }else console.log('Selected baseline has a single profile read.');
  }
  else {
    assert.equal(reads.length,1)
    assert.equal(await page.getByTestId('data').count(),0)
    await page.evaluate(()=>window.fixture.releaseProfile('A'));await waitReady()
    assert.deepEqual((await data()).books,['BOOK-A'])
    assert.deepEqual(await page.evaluate(()=>window.fixture.routes),['/portal'])
    assert.deepEqual(await page.evaluate(()=>window.fixture.extraReads),[])
    const starts=await page.evaluate(()=>window.fixture.starts.length)
    await page.getByRole('button',{name:'Toggle extra subscriber'}).click()
    await page.getByRole('button',{name:'Toggle extra subscriber'}).click()
    assert.equal(await page.evaluate(()=>window.fixture.starts.length),starts)

    await page.evaluate(()=>window.fixture.authContext.logout());await page.getByRole('button',{name:'Login',exact:true}).waitFor()
    assert.deepEqual(await page.evaluate(()=>window.fixture.data.bookings),[])
    assert.deepEqual(await page.evaluate(()=>window.fixture.activeStreams()),[])
    await signIn('B');await page.evaluate(()=>window.fixture.releaseProfile('B'));await waitReady()
    await page.evaluate(()=>window.fixture.emitRetired())
    assert.deepEqual((await data()).books,['BOOK-B'])
    assert.deepEqual((await data()).payments,['PAY-B'])

    await open('?returning=A&path=/portal')
    await page.getByText('Loading your profile and permissions…',{exact:true}).waitFor()
    assert.deepEqual(await page.evaluate(()=>window.fixture.routes),[])
    await page.evaluate(()=>window.fixture.emitAuth('B'))
    await page.waitForFunction(()=>window.fixture.pendingProfiles().includes('B'))
    await page.evaluate(()=>{window.fixture.releaseProfile('B');window.fixture.releaseProfile('A')});await waitReady()
    assert.equal(await page.evaluate(()=>window.fixture.authContext.user.id),'B')
    assert.deepEqual((await data()).books,['BOOK-B'])

    await open('?path=/portal');await page.getByRole('button',{name:'Login',exact:true}).waitFor()
    assert.deepEqual(await page.evaluate(()=>window.fixture.routes),['/'])
    // Enter a protected route with a failed profile; show recovery, not a redirect.
    await open('?returning=A&path=/portal')
    await page.evaluate(()=>{window.fixture.profileFailure='permission-denied';window.fixture.emitAuth('B')})
    await page.getByRole('button',{name:'Retry account loading',exact:true}).waitFor()
    await page.screenshot({path:join(output,'profile-initialization-error.png'),fullPage:true})
    assert.deepEqual(await page.evaluate(()=>window.fixture.routes),[])
    await page.evaluate(()=>window.fixture.profileFailure=null)
    await page.getByRole('button',{name:'Retry account loading',exact:true}).click()
    await page.waitForFunction(()=>window.fixture.pendingProfiles().includes('B'))
    await page.evaluate(()=>window.fixture.releaseProfile('B'));await waitReady()

    await page.evaluate(()=>{window.fixture.datasetFailures.bookings=2;window.fixture.data.retryData()})
    await page.getByRole('button',{name:'Retry data loading',exact:true}).waitFor()
    await page.screenshot({path:join(output,'data-loading-error.png'),fullPage:true})
    await page.getByRole('button',{name:'Retry data loading',exact:true}).click();await waitReady()
    assert.equal(await page.getByRole('button',{name:'Retry data loading',exact:true}).count(),0)

    await open('?returning=Admin&path=/dashboard')
    await page.waitForFunction(()=>window.fixture.pendingProfiles().includes('Admin'))
    await page.evaluate(()=>window.fixture.releaseProfile('Admin'));await waitReady()
    assert.equal(await page.evaluate(()=>window.fixture.authContext.user.role),'admin')
    await open('?returning=A&path=/dashboard')
    await page.waitForFunction(()=>window.fixture.pendingProfiles().includes('A'))
    await page.evaluate(()=>window.fixture.releaseProfile('A'))
    await page.getByRole('button',{name:'Login',exact:true}).waitFor()
    assert.deepEqual(await page.evaluate(()=>window.fixture.routes),['/'])
    assert.equal(await page.getByTestId('data').count(),0)
    await open('?returning=Staff&path=/dashboard')
    await page.waitForFunction(()=>window.fixture.pendingProfiles().includes('Staff'))
    await page.evaluate(()=>window.fixture.releaseProfile('Staff'));await waitReady()
    await page.evaluate(()=>{window.fixture.profiles.Staff.permissions.payments=false;void window.fixture.authContext.refreshUser()})
    await page.waitForFunction(()=>window.fixture.pendingProfiles().includes('Staff'))
    await page.evaluate(()=>window.fixture.releaseProfile('Staff'))
    await page.waitForFunction(()=>window.fixture.authContext.user?.permissions?.payments===false)

    await open('?returning=A&path=/portal&calendar&perf=1')
    await page.evaluate(()=>{window.fixture.cacheOnly=true;window.fixture.releaseProfile('A')})
    await page.getByTestId('data').waitFor()
    assert.equal((await data()).loading,true)
    await page.evaluate(()=>{window.fixture.cacheOnly=false;window.fixture.emitData()});await waitReady()
    await page.waitForFunction(()=>window.fixture.calendar&&!window.fixture.calendar.loading)
    assert.equal(await page.evaluate(()=>window.fixture.requests.length),1,'identical hook requests must share one GET')
    await page.evaluate(()=>window.fixture.changeCalendar({render:1}))
    await page.getByTestId('calendar').waitFor()
    assert.equal(await page.evaluate(()=>window.fixture.requests.length),1,'new resource/catalog object identities must not restart the same request')
    await page.evaluate(()=>{window.fixture.deferHttp=true;window.fixture.changeCalendar({month:1})})
    await page.waitForFunction(()=>window.fixture.httpPending()===1)
    await page.evaluate(()=>window.fixture.changeCalendar({month:2,room:'two'}))
    await page.waitForFunction(()=>window.fixture.httpPending()===2)
    await page.evaluate(()=>window.fixture.finishHttp())
    await page.waitForFunction(()=>!window.fixture.calendar.loading)
    assert.ok((await page.evaluate(()=>Object.keys(window.fixture.calendar.days))).every(day=>day.startsWith('2030-03-')))
    assert.equal(await page.evaluate(()=>window.fixture.requests[1].aborted),true)
    await page.evaluate(()=>{window.fixture.deferHttp=false;window.fixture.failHttp=true;window.fixture.calendar.retry()})
    await page.waitForFunction(()=>!!window.fixture.calendar.error)
    assert.deepEqual(await page.evaluate(()=>window.fixture.calendar.days),{})
    await page.evaluate(()=>window.fixture.calendar.retry())
    await page.waitForFunction(()=>!window.fixture.calendar.loading&&!window.fixture.calendar.error)
    evidence.push(await page.evaluate(()=>({scenario:'completed',profileReads:window.fixture.profileReads,requests:window.fixture.requests,starts:window.fixture.starts,unexpected:window.fixture.unexpected})))
    assert.deepEqual(await page.evaluate(()=>window.fixture.unexpected),[])
    assert.deepEqual(logs.filter(log=>log.type==='runtime'),[])
    await page.screenshot({path:join(output,'initialized.png'),fullPage:true})
    console.log('PASS: fresh/returning login, account switching, stale profile/listener isolation, protected routes, cache-first loading, profile/data retry, subscriber stability, deduplication, stable keys, obsolete requests and failed-read recovery.')
  }
} finally { await writeFile(join(output,'evidence.json'),JSON.stringify({evidence,logs},null,2));await browser?.close();await server.close();console.log(`Initialization artifacts: ${output}`) }
