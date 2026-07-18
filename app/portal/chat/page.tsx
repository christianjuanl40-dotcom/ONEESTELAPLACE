"use client"

import { useState, useRef, useEffect } from "react"
import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { useChat } from "@/src/modules/shared/contexts/chat-context"
import { Button } from "@/src/modules/shared/components/ui/button"
import { ShieldCheck, Paperclip, Send, MessageCircle, X } from "lucide-react"
import { clearUnread, getUnreadCount, incrementUnread } from "@/src/modules/shared/lib/chat-unread"

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

export default function ClientSupportChatPage() {
  const { user } = useAuth()

  const { messages, sendMessage, isChatLoaded, markAsReadByClient } = useChat()
  
  const [inputValue, setInputValue] = useState("")
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null)
  const [nowTick, setNowTick] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const hasGreeted = useRef(false)

  const predefinedAnswers: Record<string, string> = {
    "How do I book a venue?": "To book a venue, please go to the 'My Bookings' tab and click on 'New Booking' to select your preferred date and space.",
    "What are the payment methods?": "We accept Bank Transfer, GCash, Maya, and Pay at the Office payments at our main office.",
    "Can I reschedule my event?": "Yes! Rescheduling is allowed up to 30 days before the event, subject to venue availability."
  }
  const predefinedQuestions = Object.keys(predefinedAnswers)

  const myMessages = messages.filter((m: any) => m.clientId === user?.id)
  const hasRealAdminReplied = myMessages.some((m: any) => m.sender === "admin" && !m.isBot)

  const unreadCount = myMessages.filter((m: any) => m.sender === "admin" && !m.isReadByClient).length

  useEffect(() => {
    if (unreadCount > 0) {
      incrementUnread("client", unreadCount)
    }
  }, [unreadCount])

  useEffect(() => {
    if (isChatLoaded && user?.id && myMessages.length === 0 && !hasGreeted.current) {
      hasGreeted.current = true
      sendMessage("Hello! Welcome to One Estela Place Support. How can we help you today?", "admin", user.id, user.name, true)
    }
  }, [isChatLoaded, user?.id, myMessages.length])

  useEffect(() => {
    if (unreadCount > 0 && user?.id) {
      markAsReadByClient(user.id)
      clearUnread("client")
    }
  }, [unreadCount, user?.id, markAsReadByClient])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [myMessages.length])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (event) => setImagePreview(event.target?.result as string)
    reader.readAsDataURL(file)
  }

  const handleSend = (text: string = inputValue) => {
    if (!text.trim() && !imagePreview) return
    sendMessage(text, "client", user?.id, user?.name, false, imagePreview || undefined) 
    setInputValue("")
    setImagePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ""

    if (text && predefinedAnswers[text]) {
      setTimeout(() => { sendMessage(predefinedAnswers[text], "admin", user?.id, user?.name, true) }, 600)
    } else if (text) {
      const customMsgsCount = myMessages.filter((m: any) => m.sender === "client" && !predefinedAnswers[m.text]).length
      if (customMsgsCount === 0) {
        setTimeout(() => { sendMessage("Thank you for your message! An admin will review it and assist you shortly.", "admin", user?.id, user?.name, true) }, 1000)
      }
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
            <div className="flex items-center gap-1.5 mt-0.5"><div className="w-2 h-2 rounded-full bg-emerald-500"></div><span className="text-xs font-medium text-emerald-600">Online and ready to help</span></div>
          </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-slate-50/50">
          {myMessages.map((msg: any, idx: number) => {
            const showDateSeparator = idx === 0 || !isSameDay(myMessages[idx - 1]?.timestamp, msg.timestamp)
            return (
              <div key={msg.id}>
                {showDateSeparator && (
                  <div className="flex items-center gap-3 py-2">
                    <div className="flex-1 h-px bg-slate-200" />
                    <span className="text-[11px] font-semibold text-slate-400 shrink-0">{getDateLabel(msg.timestamp)}</span>
                    <div className="flex-1 h-px bg-slate-200" />
                  </div>
                )}
                <div className={`flex items-start gap-3 ${msg.sender === "client" ? "justify-end" : ""}`}>
                  {msg.sender === "admin" && (<div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 shrink-0 mt-1"><ShieldCheck className="w-4 h-4" /></div>)}
                  <div className={`flex flex-col gap-1 max-w-[75%] ${msg.sender === "client" ? "items-end" : ""}`}>
                    <div className={`shadow-sm text-[15px] leading-relaxed flex flex-col gap-1.5 ${msg.sender === "client" ? "items-end" : "items-start"}`}>
                      {msg.imageUrl && (
                        <div 
                          className={`p-1 bg-white border border-slate-200 shadow-sm cursor-zoom-in hover:opacity-90 transition-opacity ${msg.sender === "client" ? "rounded-2xl rounded-tr-sm" : "rounded-2xl rounded-tl-sm"}`}
                          onClick={() => setFullScreenImage(msg.imageUrl)}
                        >
                          <img src={msg.imageUrl} alt="attached" className="max-w-[200px] md:max-w-[300px] rounded-xl object-cover border border-slate-100" />
                        </div>
                      )}
                      {msg.text && (<div className={`px-5 py-3 ${msg.sender === "client" ? "bg-[#ea580c] text-white rounded-2xl rounded-tr-sm" : "bg-white border border-slate-200 text-slate-700 rounded-2xl rounded-tl-sm"}`}>{msg.text}</div>)}
                    </div>
                    <span className={`text-[10px] font-medium text-slate-400 ${msg.sender === "client" ? "mr-1" : "ml-1"}`}>{formatMessageTime(msg.timestamp, nowTick)}</span>
                  </div>
                  {msg.sender === "client" && (<div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center text-white text-xs font-bold shrink-0 mt-1 uppercase">{user?.name?.charAt(0) || "C"}</div>)}
                </div>
              </div>
            )
          })}
          <div ref={chatEndRef} /> 
        </div>

        <div className="bg-white shrink-0 border-t border-slate-100 flex flex-col relative">
          {imagePreview && (
            <div className="px-6 pt-4 pb-0 relative flex justify-end animate-in zoom-in-75">
              <div className="relative border-4 border-slate-100 rounded-xl shadow-inner bg-slate-50 p-1">
                <img src={imagePreview} alt="preview" className="h-24 w-auto rounded-lg object-cover" />
                <button onClick={() => { setImagePreview(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="absolute -top-3 -right-3 bg-slate-800 text-white rounded-full p-1 hover:bg-slate-900 shadow-lg hover:scale-110 transition-transform"><X className="w-4 h-4" /></button>
              </div>
            </div>
          )}

          {!hasRealAdminReplied && (
            <div className="flex flex-wrap gap-2 px-4 sm:px-6 pt-4 pb-1">
              {predefinedQuestions.map((q, idx) => (
                <Button key={idx} variant="outline" size="sm" onClick={() => handleSend(q)} className="text-xs font-medium text-orange-700 bg-orange-50 border-orange-200 hover:bg-orange-100 hover:text-orange-800 rounded-full h-8"><MessageCircle className="w-3 h-3 mr-1.5" />{q}</Button>
              ))}
            </div>
          )}

          <div className="p-4 md:p-6">
            <div className="flex items-center gap-3 w-full bg-slate-50 border border-slate-200 rounded-full pl-4 pr-1.5 py-1.5 focus-within:ring-2 focus-within:ring-orange-500/20 focus-within:border-orange-500 transition-all">
              <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
              <button onClick={() => fileInputRef.current?.click()} className="text-slate-400 hover:text-orange-600 transition-colors shrink-0"><Paperclip className="w-5 h-5" /></button>
              <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} placeholder="Type a message..." className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-[15px] px-2 h-10 placeholder:text-slate-400 w-full" />
              <Button onClick={() => handleSend()} className="w-10 h-10 rounded-full bg-[#ea580c] hover:bg-[#c2410c] text-white p-0 shrink-0 shadow-sm transition-transform hover:scale-105 active:scale-95"><Send className="w-4 h-4 ml-0.5" /></Button>
            </div>
          </div>
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