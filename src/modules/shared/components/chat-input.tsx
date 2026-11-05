import { useState } from "react"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Textarea } from "@/src/modules/shared/components/ui/textarea"
import { Send, Loader2 } from "lucide-react"
import { cn } from "@/src/modules/shared/lib/utils"

interface ChatInputProps {
  onSendMessage: (message: string) => Promise<void>
  isLoading?: boolean
  disabled?: boolean
  placeholder?: string
}

export function ChatInput({
  onSendMessage,
  isLoading = false,
  disabled = false,
  placeholder = "Type a message...",
}: ChatInputProps) {
  const [message, setMessage] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim() || isLoading || disabled) return

    try {
      await onSendMessage(message.trim())
      setMessage("")
    } catch (error) {
      console.error("Failed to send message:", error)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e as any)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border-t bg-white p-4">
      <div className="flex gap-2">
        <Textarea
          aria-label="Chat message"
          rows={1}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isLoading || disabled}
          className="max-h-32 min-h-10 flex-1 resize-y rounded-2xl border-gray-300 py-2"
        />
        <Button
          type="submit"
          disabled={!message.trim() || isLoading || disabled}
          size="icon"
          className="rounded-full"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </form>
  )
}
