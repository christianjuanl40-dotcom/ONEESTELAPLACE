"use client"

import { useState, useRef, useEffect } from "react"
import { usePathname } from "next/navigation"
import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { useChat } from "@/src/modules/shared/contexts/chat-context"
import { Button } from "@/src/modules/shared/components/ui/button"
import { MessageSquare, X, Send, Paperclip, ShieldCheck } from "lucide-react"
import { ChatSuggestionPills } from "@/src/modules/shared/components/chat-suggestion-pills"
import { useChatSuggestions } from "@/src/modules/shared/hooks/use-chat-suggestions"
import type { ChatSuggestion } from "@/src/modules/shared/lib/chat-suggestions"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import { useChatScroll } from "@/src/modules/shared/hooks/use-chat-scroll"
import { sortChatMessages, shouldGroupChatMessage } from "../lib/chat-presentation"
import { formatManilaDateTime, formatManilaDayLabel, formatManilaTime, isSameManilaDay, toValidDate } from "../lib/time-format"

export function ClientChatWidget() {
  const pathname = usePathname()
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
    unreadMessages,
    unreadMessagesIsBounded,
  } = useChat()
  const { toast } = useToast()

  const [isOpen, setIsOpen] = useState(false)
  const [inputValue, setInputValue] = useState("")
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const sendInProgress = useRef(false)

  const myMessages = sortChatMessages(messages.filter((m: any) => m.clientId === user?.id))
  const {
    containerRef,
    endRef,
    handleScroll,
    isNearBottom,
    scrollToBottom,
    preserveScrollPosition,
    clearPreservedScrollPosition,
  } = useChatScroll(myMessages.length, isOpen ? user?.id || null : null)
  const unreadCount = unreadMessages
  const { suggestions, context: suggestionContext, dismiss: dismissSuggestions } = useChatSuggestions({
    visible: isOpen && pathname !== "/portal/chat",
    chatReady: isChatLoaded && pathname !== "/portal/chat",
  })

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
    if (isOpen && pathname !== "/portal/chat") {
      loadChat()
    } else if (pathname !== "/portal/chat") {
      unloadChat()
    }
  }, [isOpen, pathname, loadChat, unloadChat])

  useEffect(() => {
      if (isOpen && unreadCount > 0 && user?.id) { void markAsReadByClient(user.id) }
  }, [isOpen, unreadCount, user?.id, markAsReadByClient])

  const shouldShowWidget = pathname !== "/portal/chat" && user;
  if (!shouldShowWidget) return null;

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
      console.error("[ClientChatWidget] message send failed", error)
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
      console.error("[ClientChatWidget] predefined question send failed", error)
      toast({ title: "Question not sent", description: error instanceof Error ? error.message : "Check your connection and try again." })
    } finally {
      sendInProgress.current = false
      setIsSending(false)
    }
  }

  return (
    <>
      {isOpen && (
        <div className="fixed bottom-5 right-5 sm:bottom-6 sm:right-6 w-full sm:w-[380px] h-[calc(100dvh-80px)] sm:h-[calc(100vh-100px)] sm:max-h-[650px] bg-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.2)] border border-slate-200 flex flex-col z-50 overflow-hidden animate-in slide-in-from-bottom-5 duration-300">
          <div className="bg-[#ea580c] px-4 py-3 flex items-center justify-between text-white shrink-0 z-10 shadow-md">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center border border-white/10"><ShieldCheck className="w-5 h-5 text-white" /></div>
              <div>
                <h3 className="font-bold text-sm tracking-tight">Admin Support</h3>
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div><p className="text-[10px] text-orange-100 font-semibold uppercase tracking-wider">Online</p></div>
              </div>
            </div>
           <button type="button" aria-label="Close chat support" onClick={() => setIsOpen(false)} className="hover:bg-white/20 p-1.5 rounded-full transition-colors active:scale-95"><X className="w-5 h-5" /></button>
          </div>

            <div ref={containerRef} onScroll={handleScroll} className="relative flex-1 overflow-y-auto bg-slate-50 flex flex-col p-4 space-y-2">
              {hasOlderMessages && (
                <div className="flex justify-center pb-1">
                  <Button type="button" variant="outline" size="sm" onClick={() => void handleLoadOlder()} disabled={isLoadingOlder}>
                    {isLoadingOlder ? "Loading older messages…" : "Load older messages"}
                  </Button>
                </div>
              )}
              {chatError && (
               <div className="mb-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800" role="alert">
                 <p>{chatError}</p>
                 <Button type="button" variant="outline" size="sm" className="mt-2 h-8 text-xs" onClick={retryChat}>Retry chat</Button>
               </div>
             )}
             {isChatLoading && isChatLoaded && <p className="p-3 text-center text-[11px] font-semibold text-slate-500" role="status">Refreshing messages…</p>}
             {!isChatLoaded && !chatError && <p className="p-6 text-center text-xs font-medium text-slate-500" role="status">Loading messages…</p>}
             {myMessages.map((msg: any, index: number) => {
               const previousMessage = myMessages[index - 1]
               const isGrouped = shouldGroupChatMessage(previousMessage, msg)
               const showDateSeparator = index === 0 || !isSameManilaDay(previousMessage?.timestamp, msg.timestamp)
               const dateLabel = formatManilaDayLabel(msg.timestamp)
               const messageTime = formatManilaTime(msg.timestamp)
               const fullTimestamp = formatManilaDateTime(msg.timestamp)
               const timestampDate = toValidDate(msg.timestamp)
               return (
               <div key={msg.id || msg.firestoreId || `${index}-${msg.text}`} className={`flex flex-col gap-1 max-w-[85%] ${isGrouped ? "mt-0" : "mt-2"} ${msg.sender === "client" ? "self-end items-end" : "self-start items-start"}`}>
                 {showDateSeparator && dateLabel && <div className="flex w-full items-center gap-2 py-2"><div className="h-px flex-1 bg-slate-200" /><span className="shrink-0 text-[10px] font-semibold text-slate-400">{dateLabel}</span><div className="h-px flex-1 bg-slate-200" /></div>}
                 {!isGrouped && msg.sender === "admin" && <span className="px-1 text-[9px] font-bold text-slate-500">{msg.isBot ? "One Estela Place Support · Automated reply" : msg.senderName || "Support"}</span>}
                 <div className={`shadow-sm text-[13px] leading-relaxed flex flex-col gap-1 ${msg.sender === "client" ? "items-end" : "items-start"}`}>
                   {msg.imageUrl && (<button type="button" aria-label="View attached image" className={`p-1 bg-white rounded-xl border border-slate-200 shadow-sm cursor-zoom-in hover:opacity-90 transition-opacity ${msg.sender === "client" ? "rounded-tr-sm" : "rounded-tl-sm"}`} onClick={() => setFullScreenImage(msg.imageUrl)}><img src={msg.imageUrl} alt="attached" className="max-w-full rounded-lg object-cover" /></button>)}
                   {msg.text && (<div className={`break-words whitespace-pre-wrap px-4 py-2.5 ${msg.sender === "client" ? `bg-[#ea580c] text-white rounded-2xl ${isGrouped ? "rounded-tr-md" : "rounded-tr-sm"}` : `bg-white border border-slate-200 text-slate-700 rounded-2xl ${isGrouped ? "rounded-tl-md" : "rounded-tl-sm"}`}`}>{msg.text}</div>)}
                 </div>
                 {messageTime && <time dateTime={timestampDate?.toISOString()} title={fullTimestamp || undefined} aria-label={fullTimestamp || messageTime} className="text-[9px] text-slate-400 font-bold px-1">{messageTime}</time>}
               </div>
               )
             })}
             <div ref={endRef} className="h-2 shrink-0" />
             {!isNearBottom && myMessages.length > 0 && <button type="button" onClick={() => scrollToBottom("auto")} className="sticky bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full border border-orange-200 bg-white px-3 py-2 text-xs font-bold text-orange-700 shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">Jump to latest</button>}
           </div>

          <div className="p-3 bg-white border-t border-slate-100 shrink-0">
            {imagePreview && (
              <div className="relative mb-3 w-fit animate-in zoom-in-75">
                <img src={imagePreview} alt="preview" className="h-20 w-auto rounded-xl border-2 border-slate-100 shadow-md" />
                 <button type="button" aria-label="Remove image attachment" onClick={() => { setImagePreview(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="absolute -top-2 -right-2 bg-slate-800 text-white rounded-full p-1 shadow-lg hover:scale-110 transition-transform"><X className="w-3 h-3" /></button>
              </div>
            )}
            <ChatSuggestionPills
              suggestions={suggestions}
              bookingLabel={suggestionContext?.bookingId ? suggestionContext.bookingLabel : undefined}
              onSelect={handleSuggestionSelect}
              onDismiss={dismissSuggestions}
              disabled={isSending}
            />
             <div className="flex items-end gap-2 bg-slate-50 border border-slate-200 rounded-2xl pl-3 pr-1.5 py-1.5 focus-within:ring-2 focus-within:ring-orange-500/20 focus-within:border-orange-500 transition-all">
               <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={(e) => { const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onload = (ev) => setImagePreview(ev.target?.result as string); reader.readAsDataURL(file); } }} />
               <button type="button" aria-label="Attach an image" onClick={() => fileInputRef.current?.click()} className="mb-2 text-slate-400 hover:text-orange-600 p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"><Paperclip className="w-4 h-4 sm:w-5 sm:h-5" /></button>
               <textarea aria-label="Message admin" rows={1} value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend() } }} placeholder="Message admin..." disabled={isSending} className="flex-1 max-h-28 min-h-11 resize-y bg-transparent border-none focus:outline-none text-[13px] sm:text-[14px] py-2 placeholder:text-slate-400" />
               <Button type="button" onClick={() => void handleSend()} disabled={isSending || (!inputValue.trim() && !imagePreview)} aria-label="Send message" className="mb-0 w-11 h-11 sm:w-9 sm:h-9 rounded-full bg-[#ea580c] hover:bg-[#c2410c] text-white p-0 shrink-0 shadow-sm active:scale-90 transition-transform disabled:cursor-not-allowed disabled:opacity-60"><Send className="w-4 h-4 sm:w-4 sm:h-4 ml-0.5" /></Button>
            </div>
          </div>
        </div>
      )}

      {/* ✨ INALIS NATIN YUNG "relative" NA CLASS DITO AT GINAWANG z-[99999] PARA LUTANG NA LUTANG ✨ */}
      {!isOpen && (
        <button 
          type="button"
           aria-label={unreadCount > 0
             ? `Open chat support, ${unreadMessagesIsBounded ? "500+" : unreadCount} unread messages`
             : "Open chat support"}
          onClick={() => setIsOpen(true)} 
          className="fixed bottom-5 right-5 sm:bottom-6 sm:right-6 w-14 h-14 sm:w-14 sm:h-14 bg-[#ea580c] hover:bg-[#c2410c] text-white rounded-full shadow-[0_10px_30px_rgba(234,88,12,0.4)] flex items-center justify-center z-50 transition-all hover:scale-110 active:scale-95 group"
        >
          <MessageSquare className="w-5 h-5 sm:w-6 sm:h-6 group-hover:animate-pulse" />
          
          {unreadCount > 0 && (
            <div className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-red-600 border-[2px] border-white"></span>
            </div>
          )}
        </button>
      )}

      {fullScreenImage && (
        <div className="fixed inset-0 z-[10001] bg-black/90 flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-200 backdrop-blur-sm" onClick={() => setFullScreenImage(null)}>
           <button type="button" aria-label="Close image preview" className="absolute top-6 right-6 text-white/70 hover:text-white transition-colors bg-white/10 hover:bg-white/20 p-2 rounded-full" onClick={(e) => { e.stopPropagation(); setFullScreenImage(null); }}><X className="w-6 h-6 sm:w-8 sm:h-8" /></button>
          <img src={fullScreenImage} alt="Fullscreen view" className="max-w-full max-h-full rounded-lg object-contain shadow-2xl animate-in zoom-in-95" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}
