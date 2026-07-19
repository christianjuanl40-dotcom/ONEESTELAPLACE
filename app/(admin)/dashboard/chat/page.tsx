"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { useChat } from "@/src/modules/shared/contexts/chat-context"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Paperclip, Send, ShieldCheck, Search, X } from "lucide-react"
import { UserAvatar } from "@/src/modules/shared/components/user-avatar"
import { db } from "@/lib/firebase"
import { collection, getDocs } from "firebase/firestore"

function formatMessageTime(timestamp?: string | number | Date, now: Date = new Date()): string {
  if (!timestamp) return ""
  const date = new Date(timestamp)
  if (isNaN(date.getTime())) return ""
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffMins < 1) return "Just now"
  if (diffMins < 60) return `${diffMins} ${diffMins === 1 ? "min" : "mins"} ago`
  if (diffDays === 0) return `${Math.floor(diffMins / 60)} ${Math.floor(diffMins / 60) === 1 ? "hour" : "hours"} ago`
  if (diffDays === 1) return "Yesterday"
  return date.toLocaleDateString([], { month: "long", day: "2-digit", year: "numeric" })
}

function getDateLabel(timestamp?: string | number | Date): string {
  if (!timestamp) return ""
  const date = new Date(timestamp)
  if (isNaN(date.getTime())) return ""
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: "long" })
  return date.toLocaleDateString([], { month: "long", day: "2-digit", year: "numeric" })
}

function isSameDay(ts1?: string | number | Date, ts2?: string | number | Date): boolean {
  if (!ts1 || !ts2) return true
  const d1 = new Date(ts1)
  const d2 = new Date(ts2)
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate()
}

export default function AdminSupportChatPage() {
  const { user } = useAuth()
  const router = useRouter()
  const { messages, sendMessage, markAsRead } = useChat()

  useEffect(() => {
    if (user && user.role === "staff" && !user.permissions?.chat) {
      router.replace("/dashboard")
    }
  }, [user, router])
  
  const [searchQuery, setSearchQuery] = useState("")
  const [activeClientId, setActiveClientId] = useState<any>(null)
  const [inputValue, setInputValue] = useState("")
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null)
  const [nowTick, setNowTick] = useState(() => new Date())
  const [userProfilePictures, setUserProfilePictures] = useState<Record<string, string>>({})

  useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const getDynamicClients = () => {
    const clientsMap = new Map()
    messages.forEach((m: any) => {
      if (m.clientId) {
        const existing = clientsMap.get(m.clientId) || {
          id: m.clientId,
          name: m.clientName || "Unknown Client",
          profilePicture: m.clientProfilePicture || userProfilePictures[m.clientId] || "",
          unread: 0,
          lastTimestamp: 0,
        }
        if (!existing.profilePicture) {
          existing.profilePicture = m.clientProfilePicture || userProfilePictures[m.clientId] || ""
        }
        const msgTime = new Date(m.timestamp || 0).getTime()
        if (msgTime > existing.lastTimestamp) { existing.lastTimestamp = msgTime }
        if (m.sender === "client" && !m.isRead) { existing.unread += 1 }
        clientsMap.set(m.clientId, existing)
      }
    })
    return Array.from(clientsMap.values()).sort((a: any, b: any) => b.lastTimestamp - a.lastTimestamp)
  }

  const clientsList = getDynamicClients()
  const filteredClientsList = searchQuery
    ? clientsList.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : clientsList
  const activeClient = filteredClientsList.find(c => c.id === activeClientId) || filteredClientsList[0] || null
  const activeClientMessages = activeClient ? messages.filter((m: any) => m.clientId === activeClient.id) : []

  useEffect(() => { if (!activeClientId && filteredClientsList.length > 0) { setActiveClientId(filteredClientsList[0].id) } }, [filteredClientsList.map(c => c.id).join(",")])
  
  useEffect(() => { 
    if (activeClientId) { markAsRead(activeClientId) }
  }, [activeClientId])
  
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }) }, [activeClientMessages])

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const snapshot = await getDocs(collection(db, "users"))
        const map: Record<string, string> = {}
        snapshot.forEach((docSnap) => {
          const data = docSnap.data()
          if (data.profilePicture) map[docSnap.id] = data.profilePicture
        })
        setUserProfilePictures(map)
      } catch {}
    }
    fetchUsers()
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return

    const reader = new FileReader()
    reader.onload = (event) => { setImagePreview(event.target?.result as string) }
    reader.readAsDataURL(file)
  }

  const handleSend = () => {
    if (!activeClient) return
    if (!inputValue.trim() && !imagePreview) return
    
    sendMessage(inputValue, "admin", activeClient.id, activeClient.name, false, imagePreview || undefined)
    setInputValue("")
    setImagePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  return (
    <>
      <div className="flex h-full w-full bg-white rounded-none border-none overflow-x-hidden">
        {/* INBOX SIDEBAR */}
        <div className="w-80 flex flex-col border-r border-slate-200 shrink-0 bg-white">
          <div className="p-4 border-b border-slate-100">
            <h2 className="text-lg font-black text-slate-900 mb-3">Messages</h2>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 focus-within:border-orange-500 focus-within:ring-2 focus-within:ring-orange-500/20 transition-all">
              <Search className="w-4 h-4 text-slate-400" />
              <input type="text" placeholder="Search clients..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="bg-transparent border-none focus:outline-none text-sm w-full" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredClientsList.length === 0 && <p className="p-6 text-center text-xs font-medium text-slate-400">{searchQuery ? "No matching clients." : "No client messages yet."}</p>}
            {filteredClientsList.map((client: any) => {
              const clientMsgs = messages.filter((m: any) => m.clientId === client.id)
              const lastMsg = clientMsgs[clientMsgs.length - 1] 
              
              return (
                <div key={client.id} onClick={() => setActiveClientId(client.id)} className={`p-4 flex items-start gap-3 cursor-pointer border-b border-slate-50 transition-colors ${activeClientId === client.id ? "bg-orange-50 border-r-2 border-r-orange-500" : "hover:bg-slate-50"}`}>
                  <UserAvatar name={client.name} picture={client.profilePicture} className="h-10 w-10 shrink-0" ringClassName="" fallbackClassName={`${activeClientId === client.id ? "bg-slate-900" : "bg-slate-300"} text-white flex items-center justify-center`} textClassName="font-bold" />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-0.5">
                      <h3 className={`text-sm truncate ${client.unread > 0 ? "font-black text-slate-900" : (activeClientId === client.id ? "font-bold text-slate-900" : "font-semibold text-slate-700")}`}>{client.name}</h3>
                      <span className={`text-[10px] shrink-0 ${client.unread > 0 ? "text-orange-600 font-bold" : "text-slate-400"}`}>{lastMsg ? formatMessageTime(lastMsg.timestamp, nowTick) : ""}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <p className={`text-xs truncate ${client.unread > 0 ? "font-bold text-slate-900" : "text-slate-500"}`}>
                        {lastMsg ? (lastMsg.imageUrl ? "Sent an image 📷" : lastMsg.text) : "No messages yet"}
                      </p>
                      
                      {/* ✨ SUPER OBVIOUS RED BADGE PARA SA ADMIN ✨ */}
                      {client.unread > 0 && (
                        <div className="bg-red-500 text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full shadow-md shrink-0 flex items-center gap-1.5 animate-pulse">
                          <span className="w-1.5 h-1.5 bg-white rounded-full"></span>
                          {client.unread} New
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* CHAT WINDOW */}
        <div className="flex-1 flex flex-col h-full bg-white relative">
          {activeClient ? (
            <>
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0 bg-white">
                <div className="flex items-center gap-4">
                  <UserAvatar name={activeClient.name} picture={activeClient.profilePicture} className="h-12 w-12 shrink-0" ringClassName="" fallbackClassName="bg-slate-900 text-white" textClassName="font-bold uppercase" />
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 leading-tight">{activeClient.name}</h2>
                    <div className="flex items-center gap-1.5 mt-0.5"><div className="w-2 h-2 rounded-full bg-emerald-500"></div><span className="text-xs font-medium text-emerald-600">Active now</span></div>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50">
                {activeClientMessages.map((msg: any, idx: number) => {
                  const showDateSeparator = idx === 0 || !isSameDay(activeClientMessages[idx - 1]?.timestamp, msg.timestamp)
                  return (
                    <div key={msg.id}>
                      {showDateSeparator && (
                        <div className="flex items-center gap-3 py-2">
                          <div className="flex-1 h-px bg-slate-200" />
                          <span className="text-[11px] font-semibold text-slate-400 shrink-0">{getDateLabel(msg.timestamp)}</span>
                          <div className="flex-1 h-px bg-slate-200" />
                        </div>
                      )}
                      <div className={`flex items-start gap-3 ${msg.sender === "admin" ? "justify-end" : ""}`}>
                        {msg.sender === "client" && (
                          <UserAvatar name={activeClient.name} picture={activeClient.profilePicture} className="h-8 w-8 shrink-0 mt-1" ringClassName="" fallbackClassName="bg-slate-900 text-white" textClassName="font-bold uppercase text-xs" />
                        )}
                        <div className={`flex flex-col gap-1 max-w-[75%] ${msg.sender === "admin" ? "items-end" : ""}`}>
                          <div className={`shadow-sm text-[15px] leading-relaxed flex flex-col gap-1.5 ${
                            msg.sender === "admin" ? "items-end" : "items-start"
                          }`}>
                            {msg.imageUrl && (
                              <div className={`p-1 bg-white border border-slate-200 shadow-sm cursor-zoom-in hover:opacity-90 transition-opacity ${msg.sender === "admin" ? "rounded-2xl rounded-tr-sm" : "rounded-2xl rounded-tl-sm"}`} onClick={() => setFullScreenImage(msg.imageUrl)}>
                                 <img src={msg.imageUrl} alt="attached" className="max-w-[200px] md:max-w-[300px] rounded-xl object-cover border border-slate-100" />
                              </div>
                            )}
                            {msg.text && (
                              <div className={`px-5 py-3 ${
                                msg.sender === "admin" ? "bg-[#ea580c] text-white rounded-2xl rounded-tr-sm" : "bg-white border border-slate-200 text-slate-700 rounded-2xl rounded-tl-sm"
                              }`}>{msg.text}</div>
                            )}
                          </div>
                          <span className={`text-[10px] font-medium text-slate-400 ${msg.sender === "admin" ? "mr-1" : "ml-1"}`}>{formatMessageTime(msg.timestamp, nowTick)}</span>
                        </div>
                        {msg.sender === "admin" && (
                          <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 shrink-0 mt-1"><ShieldCheck className="w-4 h-4" /></div>
                        )}
                      </div>
                    </div>
                  )
                })}
                <div ref={chatEndRef} />
              </div>

              {/* INPUT AREA */}
              <div className="p-4 md:p-6 border-t border-slate-100 bg-white shrink-0 relative flex flex-col">
                {imagePreview && (
                  <div className="pb-4 pt-0 relative flex justify-end animate-in zoom-in-75">
                    <div className="relative border-4 border-slate-100 rounded-xl shadow-inner bg-slate-50 p-1">
                      <img src={imagePreview} alt="preview" className="h-24 w-auto rounded-lg object-cover" />
                      <button onClick={() => { setImagePreview(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="absolute -top-3 -right-3 bg-slate-800 text-white rounded-full p-1 hover:scale-110 transition-transform shadow-lg"><X className="w-4 h-4" /></button>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3 w-full bg-slate-50 border border-slate-200 rounded-full pl-4 pr-1.5 py-1.5 focus-within:ring-2 focus-within:ring-orange-500/20 focus-within:border-orange-500 transition-all">
                  <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
                  <button onClick={() => fileInputRef.current?.click()} className="text-slate-400 hover:text-orange-600 transition-colors shrink-0"><Paperclip className="w-5 h-5" /></button>
                  <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} placeholder={`Type your reply to ${activeClient.name}...`} className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-[15px] px-2 h-10 placeholder:text-slate-400 w-full" />
                  <Button onClick={handleSend} className="w-10 h-10 rounded-full bg-[#ea580c] hover:bg-[#c2410c] text-white p-0 shrink-0 shadow-sm active:scale-95 transition-transform"><Send className="w-4 h-4 ml-0.5" /></Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-slate-50/50">
              <p className="text-slate-400 font-medium">Select a client to start chatting</p>
            </div>
          )}
        </div>
      </div>

      {fullScreenImage && (
        <div className="fixed inset-0 z-[99999] bg-black/90 flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-200 backdrop-blur-sm" onClick={() => setFullScreenImage(null)}>
          <button className="absolute top-6 right-6 text-white/70 hover:text-white transition-colors bg-white/10 hover:bg-white/20 p-2 rounded-full" onClick={(e) => { e.stopPropagation(); setFullScreenImage(null); }}><X className="w-6 h-6 sm:w-8 sm:h-8" /></button>
          <img src={fullScreenImage} alt="Fullscreen view" className="max-w-full max-h-full rounded-lg object-contain shadow-2xl animate-in zoom-in-95" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}