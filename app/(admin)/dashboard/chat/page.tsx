"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { useChat } from "@/src/modules/shared/contexts/chat-context"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Paperclip, Send, ShieldCheck, Search, X } from "lucide-react"
import { UserAvatar } from "@/src/modules/shared/components/user-avatar"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import { db } from "@/lib/firebase"
import { collection, limit, onSnapshot, query, where } from "firebase/firestore"
import { getPresenceStatus } from "@/src/modules/shared/lib/presence"
import { useChatScroll } from "@/src/modules/shared/hooks/use-chat-scroll"
import { sortChatMessages, shouldGroupChatMessage, getChatTimestampMs } from "@/src/modules/shared/lib/chat-presentation"
import { formatManilaDateTime, formatManilaDayLabel, formatManilaTime, isSameManilaDay, toValidDate } from "@/src/modules/shared/lib/time-format"

export default function AdminSupportChatPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const router = useRouter()
  const {
    messages,
    conversationIndex,
    activeConversationId,
    sendMessage,
    markAsRead,
    loadChat,
    loadOlderMessages,
    hasOlderMessages,
    isLoadingOlder,
    unloadChat,
    isChatLoaded,
    isChatLoading,
    chatError,
    retryChat,
  } = useChat()

  useEffect(() => {
    if (user && user.role === "staff" && !user.permissions?.chat) {
      router.replace("/dashboard")
    }
  }, [user, router])

  useEffect(() => {
    loadChat()
    return unloadChat
  }, [loadChat, unloadChat])

  const inboxMessages = useMemo(
    () => sortChatMessages([...conversationIndex, ...messages]),
    [conversationIndex, messages],
  )
  
  const [searchQuery, setSearchQuery] = useState("")
  const [activeClientId, setActiveClientId] = useState<any>(null)
  const [inputValue, setInputValue] = useState("")
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null)
  const [nowTick, setNowTick] = useState(() => new Date())
  const [userProfilePictures, setUserProfilePictures] = useState<Record<string, string>>({})
  const [userPresence, setUserPresence] = useState<Record<string, number | null>>({})
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const fileInputRef = useRef<HTMLInputElement>(null)

  const getDynamicClients = () => {
    const clientsMap = new Map()
    inboxMessages.forEach((m: any) => {
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
        const msgTime = getChatTimestampMs(m.timestamp) ?? 0
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
  const selectedClientId = activeClient?.id || null

  useEffect(() => {
    if (selectedClientId && selectedClientId !== activeConversationId) {
      loadChat(selectedClientId)
    }
  }, [activeConversationId, loadChat, selectedClientId])

  const activeClientMessages = activeClient
    ? sortChatMessages(messages.filter((m: any) => m.clientId === activeClient.id))
    : []
  const activeClientPresence = activeClient ? getPresenceStatus(userPresence[activeClient.id], nowTick) : null
  const canLoadPresence = Boolean(user && (user.role !== "staff" || user.permissions?.chat))
  const {
    containerRef,
    endRef,
    handleScroll,
    isNearBottom,
    scrollToBottom,
    preserveScrollPosition,
    clearPreservedScrollPosition,
  } = useChatScroll(activeClientMessages.length, activeClient?.id || null)

  const handleLoadOlder = async () => {
    if (!loadOlderMessages || isLoadingOlder) return
    preserveScrollPosition()
    try {
      await loadOlderMessages()
    } finally {
      requestAnimationFrame(clearPreservedScrollPosition)
    }
  }

   useEffect(() => {
     if (activeClient?.id) void markAsRead(activeClient.id)
   }, [activeClient?.id, markAsRead])

   useEffect(() => {
     if (!canLoadPresence) return
    console.log("[Firestore Listener START] UsersPresence")
    const usersQuery = query(collection(db, "users"), where("role", "==", "client"), limit(500))
    const unsub = onSnapshot(usersQuery, (snapshot) => {
      const pictures: Record<string, string> = {}
      const presence: Record<string, number | null> = {}
      snapshot.forEach((docSnap) => {
        const data = docSnap.data()
        if (data.profilePicture) pictures[docSnap.id] = data.profilePicture
        const ts = data.lastActiveAt
        presence[docSnap.id] = ts?.toDate?.() ? ts.toDate().getTime() : null
      })
      setUserProfilePictures(pictures)
      setUserPresence(presence)
    }, (error: any) => {
      console.error("[UsersPresence snapshot error]", { code: error.code, message: error.message, error })
    })
    return () => {
      console.log("[Firestore Listener STOP] UsersPresence")
      unsub()
    }
  }, [canLoadPresence])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return

    const reader = new FileReader()
    reader.onload = (event) => { setImagePreview(event.target?.result as string) }
    reader.readAsDataURL(file)
  }

  const handleSend = async () => {
    if (!activeClient) return
    if (isSending || (!inputValue.trim() && !imagePreview)) return
    setIsSending(true)
    try {
      await sendMessage(inputValue, "admin", activeClient.id, activeClient.name, false, imagePreview || undefined)
      setInputValue("")
      setImagePreview(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
       scrollToBottom()
    } catch (error) {
      console.error("[AdminChat] message send failed", error)
      toast({ title: "Message not sent", description: "Check your connection and try again.", variant: "destructive" })
    } finally {
      setIsSending(false)
    }
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
               <input aria-label="Search clients" type="search" placeholder="Search clients..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="bg-transparent border-none focus:outline-none text-sm w-full" />
             </div>
           </div>

           <div className="flex-1 overflow-y-auto">
             {chatError && (
               <div className="m-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800" role="alert">
                 <p>{chatError}</p>
                 <Button type="button" variant="outline" size="sm" className="mt-2 h-8 text-xs" onClick={retryChat}>Retry chat</Button>
               </div>
             )}
             {isChatLoading && isChatLoaded && <p className="p-3 text-center text-[11px] font-semibold text-slate-500" role="status">Refreshing messages…</p>}
             {!isChatLoaded && !chatError ? (
               <p className="p-6 text-center text-xs font-medium text-slate-400" role="status">Loading conversations…</p>
             ) : filteredClientsList.length === 0 && !chatError ? (
               <p className="p-6 text-center text-xs font-medium text-slate-400">{searchQuery ? "No matching clients." : "No client messages yet."}</p>
             ) : null}
             {filteredClientsList.map((client: any) => {
               const clientMsgs = inboxMessages.filter((m: any) => m.clientId === client.id)
              const lastMsg = clientMsgs[clientMsgs.length - 1] 
              
               return (
                  <button type="button" key={client.id} onClick={() => setActiveClientId(client.id)} aria-pressed={selectedClientId === client.id} className={`w-full p-4 flex items-start gap-3 text-left cursor-pointer border-b border-slate-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500 ${selectedClientId === client.id ? "bg-orange-50 border-r-2 border-r-orange-500" : "hover:bg-slate-50"}`}>
                   <UserAvatar name={client.name} picture={client.profilePicture} className="h-10 w-10 shrink-0" ringClassName="" fallbackClassName={`${selectedClientId === client.id ? "bg-slate-900" : "bg-slate-300"} text-white flex items-center justify-center`} textClassName="font-bold" />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-0.5">
                      <h3 className={`text-sm truncate ${client.unread > 0 ? "font-black text-slate-900" : (activeClientId === client.id ? "font-bold text-slate-900" : "font-semibold text-slate-700")}`}>{client.name}</h3>
                       <span className={`text-[10px] shrink-0 ${client.unread > 0 ? "text-orange-600 font-bold" : "text-slate-400"}`}>{lastMsg ? (formatManilaTime(lastMsg.timestamp) || "") : ""}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <p className={`text-xs truncate ${client.unread > 0 ? "font-bold text-slate-900" : "text-slate-500"}`}>
                        {lastMsg ? (lastMsg.imageUrl ? "Sent an image 📷" : lastMsg.text) : "No messages yet"}
                      </p>
                      
                      {/* ✨ SUPER OBVIOUS RED BADGE PARA SA ADMIN ✨ */}
                       {client.unread > 0 && (
                         <div className="bg-red-500 text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full shadow-md shrink-0 flex items-center gap-1.5" aria-label={`${client.unread} unread messages`}>
                          <span className="w-1.5 h-1.5 bg-white rounded-full"></span>
                           {client.unread} New
                         </div>
                       )}
                     </div>
                   </div>
                 </button>
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
                    {activeClientPresence?.isActive ? (
                      <div className="flex items-center gap-1.5 mt-0.5"><div className="w-2 h-2 rounded-full bg-emerald-500"></div><span className="text-xs font-medium text-emerald-600">Active now</span></div>
                    ) : (
                      <div className="mt-0.5"><span className="text-xs font-medium text-slate-500">{activeClientPresence?.label || "Offline"}</span></div>
                    )}
                  </div>
                </div>
              </div>

               <div ref={containerRef} onScroll={handleScroll} className="relative flex-1 overflow-y-auto p-4 sm:p-6 space-y-2 bg-slate-50/50">
                 {hasOlderMessages && (
                   <div className="flex justify-center pb-2">
                     <Button type="button" variant="outline" size="sm" onClick={() => void handleLoadOlder()} disabled={isLoadingOlder}>
                       {isLoadingOlder ? "Loading older messages…" : "Load older messages"}
                     </Button>
                   </div>
                 )}
                 {activeClientMessages.map((msg: any, idx: number) => {
                  const previousMessage = activeClientMessages[idx - 1]
                  const isGrouped = shouldGroupChatMessage(previousMessage, msg)
                  const showDateSeparator = idx === 0 || !isSameManilaDay(previousMessage?.timestamp, msg.timestamp)
                  const dateLabel = formatManilaDayLabel(msg.timestamp, nowTick)
                  const messageTime = formatManilaTime(msg.timestamp)
                  const fullTimestamp = formatManilaDateTime(msg.timestamp)
                  const timestampDate = toValidDate(msg.timestamp)
                  return (
                    <div key={msg.id || msg.firestoreId || `${idx}-${msg.text}`} className={isGrouped ? "mt-1" : "mt-3"}>
                      {showDateSeparator && dateLabel && (
                        <div className="flex items-center gap-3 py-2">
                          <div className="flex-1 h-px bg-slate-200" />
                          <span className="text-[11px] font-semibold text-slate-400 shrink-0">{dateLabel}</span>
                          <div className="flex-1 h-px bg-slate-200" />
                        </div>
                      )}
                      <div className={`flex items-start gap-3 ${msg.sender === "admin" ? "justify-end" : ""}`}>
                        {msg.sender === "client" && !isGrouped && (
                          <UserAvatar name={activeClient.name} picture={activeClient.profilePicture} className="h-8 w-8 shrink-0 mt-1" ringClassName="" fallbackClassName="bg-slate-900 text-white" textClassName="font-bold uppercase text-xs" />
                        )}
                        {msg.sender === "client" && isGrouped && <div className="h-8 w-8 shrink-0" aria-hidden="true" />}
                        <div className={`flex min-w-0 max-w-[85%] flex-col gap-1 sm:max-w-[75%] ${msg.sender === "admin" ? "items-end" : ""}`}>
                          {!isGrouped && msg.sender === "client" && <span className="ml-1 text-[10px] font-bold text-slate-500">{activeClient.name}</span>}
                          <div className={`shadow-sm text-[15px] leading-relaxed flex flex-col gap-1.5 ${
                            msg.sender === "admin" ? "items-end" : "items-start"
                          }`}>
                            {msg.imageUrl && (
                              <button type="button" aria-label="View attached image" className={`p-1 bg-white border border-slate-200 shadow-sm cursor-zoom-in hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 ${msg.sender === "admin" ? "rounded-2xl rounded-tr-sm" : "rounded-2xl rounded-tl-sm"}`} onClick={() => setFullScreenImage(msg.imageUrl)}>
                                 <img src={msg.imageUrl} alt="attached" className="max-w-[200px] md:max-w-[300px] rounded-xl object-cover border border-slate-100" />
                              </button>
                            )}
                            {msg.text && (
                              <div className={`break-words whitespace-pre-wrap px-5 py-3 ${
                                msg.sender === "admin"
                                  ? `bg-[#ea580c] text-white rounded-2xl ${isGrouped ? "rounded-tr-md" : "rounded-tr-sm"}`
                                  : `bg-white border border-slate-200 text-slate-700 rounded-2xl ${isGrouped ? "rounded-tl-md" : "rounded-tl-sm"}`
                              }`}>{msg.text}</div>
                            )}
                          </div>
                          {messageTime && (
                            <time dateTime={timestampDate?.toISOString()} title={fullTimestamp || undefined} aria-label={fullTimestamp || messageTime} className={`text-[10px] font-medium text-slate-400 ${msg.sender === "admin" ? "mr-1" : "ml-1"}`}>
                              {messageTime}
                            </time>
                          )}
                        </div>
                        {msg.sender === "admin" && !isGrouped && (
                          <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 shrink-0 mt-1"><ShieldCheck className="w-4 h-4" /></div>
                        )}
                        {msg.sender === "admin" && isGrouped && <div className="h-8 w-8 shrink-0" aria-hidden="true" />}
                      </div>
                    </div>
                  )
                })}
                <div ref={endRef} />
                {!isNearBottom && activeClientMessages.length > 0 && (
                  <button type="button" onClick={() => scrollToBottom("auto")} className="sticky bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full border border-orange-200 bg-white px-3 py-2 text-xs font-bold text-orange-700 shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                    Jump to latest messages
                  </button>
                )}
              </div>

              {/* INPUT AREA */}
              <div className="p-4 md:p-6 border-t border-slate-100 bg-white shrink-0 relative flex flex-col">
                {imagePreview && (
                  <div className="pb-4 pt-0 relative flex justify-end animate-in zoom-in-75">
                    <div className="relative border-4 border-slate-100 rounded-xl shadow-inner bg-slate-50 p-1">
                      <img src={imagePreview} alt="preview" className="h-24 w-auto rounded-lg object-cover" />
                       <button type="button" aria-label="Remove image attachment" onClick={() => { setImagePreview(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="absolute -top-3 -right-3 bg-slate-800 text-white rounded-full p-1 hover:scale-110 transition-transform shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:ring-offset-2"><X className="w-4 h-4" /></button>
                    </div>
                  </div>
                )}
                 <div className="flex items-end gap-3 w-full bg-slate-50 border border-slate-200 rounded-2xl pl-4 pr-1.5 py-1.5 focus-within:ring-2 focus-within:ring-orange-500/20 focus-within:border-orange-500 transition-all">
                   <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
                   <button type="button" aria-label="Attach an image" onClick={() => fileInputRef.current?.click()} className="mb-2 text-slate-400 hover:text-orange-600 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"><Paperclip className="w-5 h-5" /></button>
                   <textarea aria-label={`Reply to ${activeClient.name}`} rows={1} value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend() } }} placeholder={`Type your reply to ${activeClient.name}...`} disabled={isSending} className="flex-1 max-h-32 min-h-10 resize-y bg-transparent border-none focus:outline-none focus:ring-0 text-[15px] px-2 py-2 placeholder:text-slate-400 w-full" />
                   <Button type="button" onClick={() => void handleSend()} disabled={isSending || (!inputValue.trim() && !imagePreview)} aria-label="Send message" className="mb-0 w-10 h-10 rounded-full bg-[#ea580c] hover:bg-[#c2410c] text-white p-0 shrink-0 shadow-sm active:scale-95 transition-transform disabled:cursor-not-allowed disabled:opacity-60"><Send className="w-4 h-4 ml-0.5" /></Button>
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
          <button type="button" aria-label="Close image preview" className="absolute top-6 right-6 text-white/70 hover:text-white transition-colors bg-white/10 hover:bg-white/20 p-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950" onClick={(e) => { e.stopPropagation(); setFullScreenImage(null); }}><X className="w-6 h-6 sm:w-8 sm:h-8" /></button>
          <img src={fullScreenImage} alt="Fullscreen view" className="max-w-full max-h-full rounded-lg object-contain shadow-2xl animate-in zoom-in-95" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}
