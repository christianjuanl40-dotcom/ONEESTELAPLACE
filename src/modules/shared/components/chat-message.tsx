import { format } from "date-fns"
import { Check, CheckCheck } from "lucide-react"
import { cn } from "@/src/modules/shared/lib/utils"

interface ChatMessageProps {
  senderName: string
  senderType: "admin" | "customer"
  content: string
  timestamp: Date
  readAt?: Date
  avatarUrl?: string
}

export function ChatMessage({
  senderName,
  senderType,
  content,
  timestamp,
  readAt,
  avatarUrl,
}: ChatMessageProps) {
  const isAdmin = senderType === "admin"

  return (
    <div className={cn("flex gap-2 mb-4", isAdmin && "flex-row-reverse")}>
      {/* Avatar */}
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold text-white",
          isAdmin ? "bg-blue-600" : "bg-gray-400"
        )}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt={senderName} className="w-full h-full rounded-full object-cover" />
        ) : (
          senderName.charAt(0).toUpperCase()
        )}
      </div>

      {/* Message Bubble */}
      <div className={cn("flex flex-col gap-1 max-w-xs", isAdmin && "items-end")}>
        <div className="text-xs font-medium text-gray-600">{senderName}</div>
        <div
          className={cn(
            "px-3 py-2 rounded-lg break-words",
            isAdmin
              ? "bg-blue-600 text-white rounded-br-none"
              : "bg-gray-200 text-gray-900 rounded-bl-none"
          )}
        >
          <p className="text-sm">{content}</p>
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <time>{format(new Date(timestamp), "HH:mm")}</time>
          {isAdmin && readAt && <CheckCheck className="h-3 w-3" />}
        </div>
      </div>
    </div>
  )
}
