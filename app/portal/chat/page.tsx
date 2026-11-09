"use client"

import { useState, useRef, useEffect } from "react"
import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { useChat } from "@/src/modules/shared/contexts/chat-context"
import { Button } from "@/src/modules/shared/components/ui/button"
import { ShieldCheck, Paperclip, Send, X } from "lucide-react"
import { UserAvatar } from "@/src/modules/shared/components/user-avatar"
import { ChatSuggestionPills } from "@/src/modules/shared/components/chat-suggestion-pills"
import { useChatSuggestions } from "@/src/modules/shared/hooks/use-chat-suggestions"
import type { ChatSuggestion } from "@/src/modules/shared/lib/chat-suggestions"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import { useChatScroll } from "@/src/modules/shared/hooks/use-chat-scroll"
import { ChatWelcome } from "@/src/modules/shared/components/chat-welcome"
import { sortChatMessages, shouldGroupChatMessage } from "@/src/modules/shared/lib/chat-presentation"
import { formatManilaDateTime, formatManilaDayLabel, formatManilaTime, isSameManilaDay, toValidDate } from "@/src/modules/shared/lib/time-format"

export default function ClientSupportChatPage() {
  const { user } = useAuth()

  const {
    messages,
    sendMessage,
    sendPredefinedQuestion,
    isChatLoaded,
    isChatLoading,
    chatError,
    retryChat,
    markAsReadByClient,
    loadChat,
    loadOlderMessages,
    hasOlderMessages,
    isLoadingOlder,
    unloadChat,
  } = useChat()
  const { toast } = useToast()
  const { suggestions, context: suggestionContext, dismiss: dismissSuggestions } = useChatSuggestions({
    visible: Boolean(user),
    chatReady: isChatLoaded,
  })
  
  const [inputValue, setInputValue] = useState("")
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null)
  const [nowTick, setNowTick] = useState(() => new Date())
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 60 * 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    loadChat()
    return unloadChat
  }, [loadChat, unloadChat])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const sendInProgress = useRef(false)

  const myMessages = sortChatMessages(messages.filter((m: any) => m.clientId === user?.id))

  const unreadCount = myMessages.filter((m: any) => m.sender === "admin" && !m.isReadByClient).length

  useEffect(() => {
    if (unreadCount > 0 && user?.id) {
      void markAsReadByClient(user.id)
    }
  }, [unreadCount, user?.id, markAsReadByClient])

  const {
    containerRef,
    endRef,
    handleScroll,
    isNearBottom,
    scrollToBottom,
    preserveScrollPosition,
    clearPreservedScrollPosition,
  } = useChatScroll(myMessages.length, user?.id || null)

  const handleLoadOlder = async () => {
    if (!loadOlderMessages || isLoadingOlder) return
    preserveScrollPosition()
    try {
      await loadOlderMessages()
    } finally {
      requestAnimationFrame(clearPreservedScrollPosition)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (event) => setImagePreview(event.target?.result as string)
    reader.readAsDataURL(file)
  }

  const handleSend = async (text: string = inputValue): Promise<boolean> => {
    if (sendInProgress.current || (!text.trim() && !imagePreview) || !user?.id) return false
    sendInProgress.current = true
    setIsSending(true)
    try {
      await sendMessage(text, "client", user.id, user.name, false, imagePreview || undefined)
      setInputValue("")
      setImagePreview(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
       scrollToBottom()
      return true
    } catch (error) {
      console.error("[ClientChat] message send failed", error)
      toast({ title: "Message not sent", description: "Check your connection and try again." })
      return false
    } finally {
      sendInProgress.current = false
      setIsSending(false)
    }
  }

  const handleSuggestionSelect = async (suggestion: ChatSuggestion) => {
    if (sendInProgress.current || !user?.id) return
    sendInProgress.current = true
    setIsSending(true)
    try {
      await sendPredefinedQuestion(suggestion.id)
      dismissSuggestions()
    } catch (error) {
      console.error("[ClientChat] predefined question send failed", error)
      toast({ title: "Question not sent", description: error instanceof Error ? error.message : "Check your connection and try again." })
    } finally {
      sendInProgress.current = false
      setIsSending(false)
    }
  }

  return (
    <>
      <div className="flex flex-col h-full w-full bg-white rounded-none border-none relative overflow-x-hidden">
        <div className="flex items-center justify-between px-4 py-4 sm:px-6 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 shrink-0"><ShieldCheck className="w-6 h-6" /></div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 leading-tight">Chat Support</h2>
            <div className="flex items-center gap-1.5 mt-0.5"><div className="w-2 h-2 rounded-full bg-emerald-500"></div><span className="text-xs font-medium text-emerald-600">Active now</span></div>
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
          {chatError && (
            <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800" role="alert">
              <p>{chatError}</p>
              <Button type="button" variant="outline" size="sm" className="mt-2 h-8 text-xs" onClick={retryChat}>Retry chat</Button>
            </div>
          )}
          {isChatLoading && isChatLoaded && <p className="p-3 text-center text-[11px] font-semibold text-slate-500" role="status">Refreshing messages…</p>}
          {!isChatLoaded && !chatError && <p className="p-8 text-center text-sm font-medium text-slate-500" role="status">Loading messages…</p>}
          <ChatWelcome ready={isChatLoaded} empty={myMessages.length === 0} error={chatError} />
          {myMessages.map((msg: any, idx: number) => {
            const previousMessage = myMessages[idx - 1]
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
                <div className={`flex items-start gap-3 ${msg.sender === "client" ? "justify-end" : ""}`}>
                  {msg.sender === "admin" && !isGrouped && (<div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 shrink-0 mt-1"><ShieldCheck className="w-4 h-4" /></div>)}
                  {msg.sender === "admin" && isGrouped && <div className="h-8 w-8 shrink-0" aria-hidden="true" />}
                  <div className={`flex min-w-0 max-w-[85%] flex-col gap-1 sm:max-w-[75%] ${msg.sender === "client" ? "items-end" : ""}`}>
                    {msg.sender === "admin" && !isGrouped && (
                      <span className="ml-1 text-[10px] font-bold text-slate-500">
                        {msg.isBot ? "One Estela Place Support · Automated reply" : msg.senderName || "Support"}
                      </span>
                    )}
                    <div className={`shadow-sm text-[15px] leading-relaxed flex flex-col gap-1.5 ${msg.sender === "client" ? "items-end" : "items-start"}`}>
                      {msg.imageUrl && (
                        <button type="button" aria-label="View attached image"
                          className={`p-1 bg-white border border-slate-200 shadow-sm cursor-zoom-in hover:opacity-90 transition-opacity ${msg.sender === "client" ? "rounded-2xl rounded-tr-sm" : "rounded-2xl rounded-tl-sm"}`}
                          onClick={() => setFullScreenImage(msg.imageUrl)}
                        >
                          <img src={msg.imageUrl} alt="attached" className="max-w-[200px] md:max-w-[300px] rounded-xl object-cover border border-slate-100" />
                        </button>
                      )}
                      {msg.text && (<div className={`break-words whitespace-pre-wrap px-5 py-3 ${msg.sender === "client" ? `bg-[#ea580c] text-white rounded-2xl ${isGrouped ? "rounded-tr-md" : "rounded-tr-sm"}` : `bg-white border border-slate-200 text-slate-700 rounded-2xl ${isGrouped ? "rounded-tl-md" : "rounded-tl-sm"}`}`}>{msg.text}</div>)}
                    </div>
                    {messageTime && <time dateTime={timestampDate?.toISOString()} title={fullTimestamp || undefined} aria-label={fullTimestamp || messageTime} className={`text-[10px] font-medium text-slate-400 ${msg.sender === "client" ? "mr-1" : "ml-1"}`}>{messageTime}</time>}
                  </div>
                  {msg.sender === "client" && !isGrouped && (<UserAvatar name={user?.name || "Client"} picture={user?.profilePicture} className="h-8 w-8 shrink-0 mt-1" ringClassName="" fallbackClassName="bg-slate-900 text-white" textClassName="font-bold uppercase text-xs" />)}
                  {msg.sender === "client" && isGrouped && <div className="h-8 w-8 shrink-0" aria-hidden="true" />}
                </div>
              </div>
            )
          })}
          <div ref={endRef} />
          {!isNearBottom && myMessages.length > 0 && (
            <button type="button" onClick={() => scrollToBottom("auto")} className="sticky bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full border border-orange-200 bg-white px-3 py-2 text-xs font-bold text-orange-700 shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
              Jump to latest messages
            </button>
          )}
        </div>

        <div className="bg-white shrink-0 border-t border-slate-100 flex flex-col relative">
          {imagePreview && (
            <div className="px-6 pt-4 pb-0 relative flex justify-end animate-in zoom-in-75">
              <div className="relative border-4 border-slate-100 rounded-xl shadow-inner bg-slate-50 p-1">
                <img src={imagePreview} alt="preview" className="h-24 w-auto rounded-lg object-cover" />
                 <button type="button" aria-label="Remove image attachment" onClick={() => { setImagePreview(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="absolute -top-3 -right-3 flex h-11 w-11 items-center justify-center bg-slate-800 text-white rounded-full hover:bg-slate-900 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600"><X className="w-4 h-4" /></button>
              </div>
            </div>
          )}

          <ChatSuggestionPills
            suggestions={suggestions}
            bookingLabel={suggestionContext?.bookingId ? suggestionContext.bookingLabel : undefined}
            onSelect={handleSuggestionSelect}
            onDismiss={dismissSuggestions}
            disabled={isSending}
          />

          <div className="p-4 md:p-6">
             <div className="flex items-end gap-3 w-full bg-slate-50 border border-slate-200 rounded-2xl pl-4 pr-1.5 py-1.5 focus-within:ring-2 focus-within:ring-orange-500/20 focus-within:border-orange-500 transition-all">
               <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
               <button type="button" aria-label="Attach an image" onClick={() => fileInputRef.current?.click()} className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:text-orange-700 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600"><Paperclip className="w-5 h-5" /></button>
               <textarea aria-label="Message support" rows={1} value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend() } }} placeholder="Type a message..." disabled={isSending} className="w-0 min-w-0 flex-1 max-h-32 min-h-11 resize-y bg-transparent border-none focus:outline-none focus:ring-0 text-[15px] px-2 py-2 placeholder:text-slate-400" />
               <Button type="button" onClick={() => void handleSend()} disabled={isSending || (!inputValue.trim() && !imagePreview)} aria-label="Send message" className="w-11 h-11 rounded-full bg-[#ea580c] hover:bg-[#c2410c] text-white p-0 shrink-0 shadow-sm transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"><Send className="w-4 h-4 ml-0.5" /></Button>
            </div>
          </div>
        </div>
      </div>

      {fullScreenImage && (
        <div className="fixed inset-0 z-[99999] bg-black/90 flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-200 backdrop-blur-sm" onClick={() => setFullScreenImage(null)}>
          <button type="button" aria-label="Close image preview" className="absolute top-6 right-6 text-white/70 hover:text-white transition-colors bg-white/10 hover:bg-white/20 p-2 rounded-full" onClick={(e) => { e.stopPropagation(); setFullScreenImage(null); }}><X className="w-6 h-6 sm:w-8 sm:h-8" /></button>
          <img src={fullScreenImage} alt="Fullscreen view" className="max-w-full max-h-full rounded-lg object-contain shadow-2xl animate-in zoom-in-95" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}
