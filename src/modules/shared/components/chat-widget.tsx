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

export function ClientChatWidget() {
  const pathname = usePathname()
  const { user } = useAuth()
  const { messages, sendMessage, sendPredefinedQuestion, isChatLoaded, markAsReadByClient, loadChat, unloadChat, unreadMessages } = useChat()
  const { toast } = useToast()

  const [isOpen, setIsOpen] = useState(false)
  const [inputValue, setInputValue] = useState("")
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const sendInProgress = useRef(false)

  const myMessages = messages.filter((m: any) => m.clientId === user?.id)
  const unreadCount = unreadMessages
  const { suggestions, context: suggestionContext, dismiss: dismissSuggestions } = useChatSuggestions({
    visible: isOpen && pathname !== "/portal/chat",
    chatReady: isChatLoaded && pathname !== "/portal/chat",
  })

  useEffect(() => {
    if (isOpen && pathname !== "/portal/chat") {
      loadChat()
    } else if (pathname !== "/portal/chat") {
      unloadChat()
    }
  }, [isOpen, pathname, loadChat, unloadChat])

  useEffect(() => {
    if (isOpen && unreadCount > 0 && user?.id) { markAsReadByClient(user.id) }
  }, [isOpen, unreadCount, user?.id, markAsReadByClient])

  useEffect(() => {
    if (isOpen) chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [isOpen, myMessages.length])

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
            <button onClick={() => setIsOpen(false)} className="hover:bg-white/20 p-1.5 rounded-full transition-colors active:scale-95"><X className="w-5 h-5" /></button>
          </div>

          <div className="flex-1 overflow-y-auto bg-slate-50 flex flex-col p-4 space-y-4">
            {myMessages.map((msg: any) => (
              <div key={msg.id} className={`flex flex-col gap-1 max-w-[85%] ${msg.sender === "client" ? "self-end items-end" : "self-start items-start"}`}>
                {msg.sender === "admin" && <span className="px-1 text-[9px] font-bold text-slate-500">{msg.isBot ? "One Estela Place Support · Automated reply" : msg.senderName || "Support"}</span>}
                <div className={`shadow-sm text-[13px] leading-relaxed flex flex-col gap-1 ${msg.sender === "client" ? "items-end" : "items-start"}`}>
                  {msg.imageUrl && (<div className="p-1 bg-white rounded-xl border border-slate-200 shadow-sm cursor-zoom-in hover:opacity-90 transition-opacity" onClick={() => setFullScreenImage(msg.imageUrl)}><img src={msg.imageUrl} alt="attached" className="max-w-full rounded-lg object-cover" /></div>)}
                  {msg.text && (<div className={`px-4 py-2.5 ${msg.sender === "client" ? "bg-[#ea580c] text-white rounded-2xl rounded-tr-sm" : "bg-white border border-slate-200 text-slate-700 rounded-2xl rounded-tl-sm"}`}>{msg.text}</div>)}
                </div>
                <span className="text-[9px] text-slate-400 font-bold px-1 uppercase">{msg.time}</span>
              </div>
            ))}
            <div ref={chatEndRef} className="h-2 shrink-0" />
          </div>

          <div className="p-3 bg-white border-t border-slate-100 shrink-0">
            {imagePreview && (
              <div className="relative mb-3 w-fit animate-in zoom-in-75">
                <img src={imagePreview} alt="preview" className="h-20 w-auto rounded-xl border-2 border-slate-100 shadow-md" />
                <button onClick={() => { setImagePreview(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="absolute -top-2 -right-2 bg-slate-800 text-white rounded-full p-1 shadow-lg hover:scale-110 transition-transform"><X className="w-3 h-3" /></button>
              </div>
            )}
            <ChatSuggestionPills
              suggestions={suggestions}
              bookingLabel={suggestionContext?.bookingId ? suggestionContext.bookingLabel : undefined}
              onSelect={handleSuggestionSelect}
              onDismiss={dismissSuggestions}
              disabled={isSending}
            />
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-full pl-3 pr-1.5 py-1.5 focus-within:ring-2 focus-within:ring-orange-500/20 focus-within:border-orange-500 transition-all">
              <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={(e) => { const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onload = (ev) => setImagePreview(ev.target?.result as string); reader.readAsDataURL(file); } }} />
              <button onClick={() => fileInputRef.current?.click()} className="text-slate-400 hover:text-orange-600 p-1.5 transition-colors"><Paperclip className="w-4 h-4 sm:w-5 sm:h-5" /></button>
              <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void handleSend() }} placeholder="Message admin..." className="flex-1 bg-transparent border-none focus:outline-none text-[13px] sm:text-[14px] h-11 placeholder:text-slate-400" />
              <Button onClick={() => void handleSend()} disabled={isSending} className="w-11 h-11 sm:w-9 sm:h-9 rounded-full bg-[#ea580c] hover:bg-[#c2410c] text-white p-0 shrink-0 shadow-sm active:scale-90 transition-transform disabled:cursor-not-allowed disabled:opacity-60"><Send className="w-4 h-4 sm:w-4 sm:h-4 ml-0.5" /></Button>
            </div>
          </div>
        </div>
      )}

      {/* ✨ INALIS NATIN YUNG "relative" NA CLASS DITO AT GINAWANG z-[99999] PARA LUTANG NA LUTANG ✨ */}
      {!isOpen && (
        <button 
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
          <button className="absolute top-6 right-6 text-white/70 hover:text-white transition-colors bg-white/10 hover:bg-white/20 p-2 rounded-full" onClick={(e) => { e.stopPropagation(); setFullScreenImage(null); }}><X className="w-6 h-6 sm:w-8 sm:h-8" /></button>
          <img src={fullScreenImage} alt="Fullscreen view" className="max-w-full max-h-full rounded-lg object-contain shadow-2xl animate-in zoom-in-95" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}
