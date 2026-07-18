"use client"

import React, { useState, useRef, useEffect } from "react"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Input } from "@/src/modules/shared/components/ui/input"
import { Dialog, DialogContent, DialogTitle, DialogHeader } from "@/src/modules/shared/components/ui/dialog"
import { useChat } from "../contexts/chat-context"
import { Send, X, MessageSquare, ShieldCheck, CheckCircle2, MoreVertical, Paperclip, Clock, FileImage } from "lucide-react"
import { useAuth } from "@/src/modules/shared/auth/auth-context"

const QUICK_REPLIES = [
  { id: "qr1", text: "How to book a venue?", reply: "To book a venue, head over to the 'My Bookings' tab on your sidebar, click 'Book Another Event', and choose your preferred schedule and venue! 😊" },
  { id: "qr2", text: "What are the payment options?", reply: "We accept Bank Transfers and Cash. You can choose to pay in Full or just a Down Payment to secure your slot." },
  { id: "qr3", text: "Can I cancel a booking?", reply: "Yes! You can cancel any 'Pending' booking directly from the 'My Bookings' tab. Just click the 'Cancel' button." }
]

export function ChatWindow({ mode }: { mode: "widget" | "full" }) {
  const { messages, sendMessage, toggleChat, currentClientId, markAdminAsRead } = useChat()
  const { user } = useAuth()
  
  const [inputValue, setInputValue] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null) 
  
  const [viewImage, setViewImage] = useState<string | null>(null)

  const myMessages = messages.filter(m => 
    m.senderId === currentClientId || m.targetId === currentClientId || (m.sender === 'admin' && m.targetId === currentClientId)
  )

  const hasAdminReplied = myMessages.some(m => m.sender === 'admin')

  useEffect(() => {
    markAdminAsRead()
  }, [myMessages, markAdminAsRead])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [myMessages, isTyping])

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!inputValue.trim()) return
    sendMessage(inputValue.trim(), "user")
    setInputValue("")
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const base64String = event.target?.result as string
      sendMessage("Sent an attachment", "user", undefined, undefined, false, base64String)
    }
    reader.readAsDataURL(file)
    
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleQuickReply = (qr: {text: string, reply: string}) => {
    sendMessage(qr.text, "user", undefined, undefined, true) 
    setIsTyping(true)            
    setTimeout(() => {
      setIsTyping(false)         
      sendMessage(qr.reply, "bot") 
    }, 1500)
  }

  const containerClasses = mode === "widget" 
    ? "flex flex-col h-[calc(100dvh-100px)] sm:h-[550px] sm:max-h-[85vh] w-full sm:w-[380px] bg-white rounded-[24px] shadow-2xl border border-gray-200 overflow-hidden" 
    : "flex flex-col h-full w-full bg-[#fafaf9] overflow-hidden"

  const paddingWrapper = mode === "full" ? "px-4 md:px-8 w-full" : "px-3 w-full"

  return (
    <div className={containerClasses}>
      
      {/* CHAT HEADER */}
      <div className={`flex w-full shrink-0 z-20 transition-colors duration-300 ${mode === 'widget' ? 'bg-[#ea580c] text-white shadow-md' : 'bg-white border-b border-gray-200 shadow-sm'}`}>
        <div className={`flex items-center justify-between py-3 md:py-4 ${paddingWrapper}`}>
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className={`rounded-full flex items-center justify-center ${mode === 'widget' ? 'w-10 h-10 bg-white/20 text-white' : 'w-10 h-10 md:w-12 md:h-12 bg-orange-100 text-[#ea580c]'}`}>
                <ShieldCheck className={mode === 'widget' ? "w-5 h-5" : "w-5 h-5 md:w-6 md:h-6"} />
              </div>
              <div className={`absolute bottom-0 right-0 w-3 h-3 md:w-3.5 md:h-3.5 bg-emerald-400 border-2 rounded-full ${mode === 'widget' ? 'border-[#ea580c]' : 'border-white'}`}></div>
            </div>
            <div>
              <h3 className={`font-bold ${mode === 'widget' ? 'text-[15px] text-white' : 'text-[15px] md:text-lg text-slate-900'}`}>
                {user?.name || "Customer"}
              </h3>
              <p className={`font-medium flex items-center mt-0.5 ${mode === 'widget' ? 'text-[10px] text-orange-100' : 'text-[11px] md:text-xs text-emerald-600'}`}>
                <CheckCircle2 className="w-3 h-3 mr-1" /> Online and ready to help
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {mode === "full" && (
              <div className="hidden sm:flex items-center gap-1">
                <Button variant="ghost" size="icon" className="text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors"><MoreVertical className="w-5 h-5" /></Button>
              </div>
            )}
            {mode === "widget" && (
              <Button variant="ghost" size="icon" className="text-white hover:bg-white/20 rounded-full h-8 w-8 transition-colors" onClick={toggleChat}>
                <X className="w-5 h-5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* CHAT MESSAGES AREA */}
      <div className="flex-1 min-h-0 overflow-y-auto w-full bg-[#fafaf9] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-track]:bg-transparent">
        <div className={`flex flex-col gap-4 py-4 md:py-6 pb-2 ${paddingWrapper}`}>
          
          {myMessages.map((msg) => {
            const isAdminMessage = msg.sender === 'admin' || msg.sender === 'bot';
            
            return (
              <div key={msg.id} className={`flex w-full ${!isAdminMessage ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2`}>
                <div className={`flex max-w-[90%] md:max-w-[75%] gap-2 md:gap-3 ${!isAdminMessage ? 'flex-row-reverse' : 'flex-row'}`}>
                  
                  <div className="shrink-0 mt-auto hidden sm:block">
                    {isAdminMessage ? (
                      <div className="w-8 h-8 bg-orange-100 text-[#ea580c] rounded-full flex items-center justify-center">
                        <ShieldCheck className="w-4 h-4" />
                      </div>
                    ) : (
                      <div className="w-8 h-8 bg-slate-800 text-white rounded-full flex items-center justify-center font-bold text-xs uppercase">
                        {user?.name ? user.name.charAt(0) : 'U'}
                      </div>
                    )}
                  </div>

                  <div className={`flex flex-col ${!isAdminMessage ? 'items-end' : 'items-start'}`}>
                    <div 
                      className={`w-fit rounded-2xl leading-relaxed shadow-sm break-words flex flex-col
                        ${mode === 'widget' ? 'text-[13px] p-3' : 'text-[14px] md:text-[15px] p-3 md:p-4'}
                        ${!isAdminMessage 
                          ? 'bg-[#ea580c] text-white rounded-br-none' 
                          : 'bg-white border border-gray-200 text-slate-800 rounded-bl-none'
                        }
                      `}
                    >
                      {msg.imageUrl && (
                        <div className="mb-2 relative rounded-xl overflow-hidden bg-black/5">
                           <img 
                             src={msg.imageUrl} 
                             alt="attachment" 
                             className="max-w-full max-h-[250px] object-cover rounded-xl cursor-pointer hover:opacity-90 transition-opacity" 
                             onClick={() => setViewImage(msg.imageUrl || null)}
                           />
                        </div>
                      )}
                      {msg.text}
                    </div>
                    <span className="text-[10px] text-slate-400 font-medium mt-1.5 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> 
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                </div>
              </div>
            )
          })}

          {isTyping && (
            <div className="flex w-full justify-start animate-in fade-in slide-in-from-bottom-2">
              <div className="flex gap-2 md:gap-3 max-w-[85%] md:max-w-[70%] flex-row">
                <div className="shrink-0 mt-auto hidden sm:block w-8 h-8 bg-orange-100 text-[#ea580c] rounded-full flex items-center justify-center"><ShieldCheck className="w-4 h-4" /></div>
                <div className={`w-fit rounded-2xl bg-white border border-gray-200 rounded-bl-none shadow-sm flex items-center gap-1.5 ${mode === 'widget' ? 'px-4 py-3 h-[38px]' : 'px-5 py-4 h-[48px]'}`}>
                  <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                  <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                  <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce"></div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* FOOTER AREA */}
      <div className="w-full shrink-0 z-10 flex flex-col bg-white border-t border-gray-100 rounded-b-[24px]">
        
        {/* PRE-DEFINED QUESTIONS */}
        {!isTyping && !hasAdminReplied && (
          <div className="w-full bg-slate-50 border-b border-gray-100 py-3 overflow-hidden animate-in fade-in slide-in-from-bottom-2">
            <div className="flex flex-nowrap overflow-x-auto gap-2 scroll-smooth px-4 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              {QUICK_REPLIES.map(qr => (
                <button
                  key={qr.id}
                  onClick={() => handleQuickReply(qr)}
                  className="shrink-0 whitespace-nowrap text-[12px] font-bold text-[#ea580c] bg-white border border-orange-200 hover:bg-[#fff7ed] hover:border-[#ea580c] px-4 py-2 rounded-full transition-all shadow-sm"
                >
                  {qr.text}
                </button>
              ))}
              <div className="w-2 shrink-0"></div>
            </div>
          </div>
        )}

        {/* INPUT BOX */}
        <div className={`py-3 md:py-4 bg-white flex flex-col ${paddingWrapper}`}>

          <form onSubmit={handleSend} className="flex items-end gap-2 md:gap-3 relative w-full">
            
            <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />

            <div className={`flex-1 bg-slate-50 border border-slate-200 rounded-[24px] flex items-center transition-colors focus-within:border-[#ea580c] focus-within:bg-white focus-within:ring-2 focus-within:ring-orange-100 ${mode === 'widget' ? 'p-1' : 'p-1.5 md:p-2'}`}>
              
              <Button type="button" variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} className={`text-slate-400 hover:text-[#ea580c] hover:bg-orange-50 rounded-full shrink-0 ${mode === 'widget' ? 'h-8 w-8' : 'h-10 w-10'}`}>
                 <Paperclip className={mode === 'widget' ? "w-4 h-4" : "w-5 h-5"} />
              </Button>
              
              <Input 
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Type a message..."
                className={`flex-1 border-none shadow-none bg-transparent focus-visible:ring-0 ${mode === 'widget' ? 'text-[13px] px-2 h-11' : 'px-2 md:px-3 text-[14px] md:text-[15px] h-11 md:h-10'}`}
              />
            </div>
            <Button type="submit" disabled={!inputValue.trim()} className={`bg-[#ea580c] hover:bg-[#c2410c] text-white rounded-full shrink-0 shadow-md transition-transform active:scale-[0.95] disabled:opacity-50 flex items-center justify-center p-0 ${mode === 'widget' ? 'h-11 w-11' : 'h-12 w-12 md:h-14 md:w-14'}`}>
              <Send className={`${mode === 'widget' ? 'w-4 h-4 ml-0.5' : 'w-5 h-5 ml-1'}`} />
            </Button>
          </form>
        </div>

      </div>

      {/* FULLSCREEN IMAGE VIEWER MODAL PARA KAY CLIENT */}
      <Dialog open={!!viewImage} onOpenChange={(open) => !open && setViewImage(null)}>
        {/* FIX: Ginaya yung modal size at style sa Payment View */}
        <DialogContent className="w-[95vw] sm:max-w-5xl max-h-[90dvh] flex flex-col p-6 bg-white rounded-2xl border-none shadow-2xl z-[10001] overflow-y-auto">
          <DialogHeader className="shrink-0 mb-4 flex flex-row items-center justify-between">
            <DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2">
              <FileImage className="w-5 h-5 text-[#ea580c]" /> Image Attachment
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 w-full h-full bg-slate-100 rounded-2xl border border-slate-200 overflow-hidden flex items-center justify-center p-2 relative group">
            {viewImage && (
              <img src={viewImage} alt="Fullscreen Attachment" className="w-full h-full object-contain drop-shadow-sm" />
            )}
          </div>
          <div className="shrink-0 mt-4 flex justify-end">
             <Button variant="outline" onClick={() => setViewImage(null)} className="rounded-xl font-bold px-8 h-11 border-slate-200 text-slate-700">Close Viewer</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function UnifiedChatWidget() {
  const { isOpen, toggleChat } = useChat()

  return (
    <div className="fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-50 flex flex-col items-end">
      {isOpen && (
        <div className="mb-4 animate-in slide-in-from-bottom-5 fade-in duration-300 origin-bottom-right">
          <ChatWindow mode="widget" />
        </div>
      )}
      {!isOpen && (
        <Button onClick={toggleChat} className="h-14 w-14 rounded-full bg-[#ea580c] hover:bg-[#c2410c] text-white shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300 relative">
          <MessageSquare className="w-6 h-6" />
        </Button>
      )}
    </div>
  )
}