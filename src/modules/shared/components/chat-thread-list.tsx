import { useState, useMemo } from "react"
import { Input } from "@/src/modules/shared/components/ui/input"
import { Badge } from "@/src/modules/shared/components/ui/badge"
import { Empty } from "@/src/modules/shared/components/ui/empty"
import { Search, MessageSquare } from "lucide-react"
import { cn } from "@/src/modules/shared/lib/utils"
import { formatDistanceToNow } from "date-fns"

interface Conversation {
  id: string
  customerName: string
  customerEmail: string
  lastMessage?: string
  lastMessageTime?: Date
  unreadCount?: number
  isOnline?: boolean
}

interface ChatThreadListProps {
  conversations: Conversation[]
  selectedConversationId?: string
  onSelectConversation: (conversation: Conversation) => void
  isLoading?: boolean
}

export function ChatThreadList({
  conversations,
  selectedConversationId,
  onSelectConversation,
  isLoading = false,
}: ChatThreadListProps) {
  const [searchQuery, setSearchQuery] = useState("")

  const filteredConversations = useMemo(() => {
    return conversations.filter(
      (conv) =>
        conv.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        conv.customerEmail.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [conversations, searchQuery])

  return (
    <div className="w-full md:w-80 border-r border-gray-200 bg-white flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-xl font-bold text-gray-900 mb-3">Conversations</h2>
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4">
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse bg-gray-200 h-16 rounded" />
              ))}
            </div>
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="p-4">
            <Empty
              heading={searchQuery ? "No conversations found" : "No conversations yet"}
              description={
                searchQuery
                  ? "Try a different search term"
                  : "Customer conversations will appear here"
              }
              icon={MessageSquare}
            />
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredConversations.map((conversation) => (
              <button
                key={conversation.id}
                onClick={() => onSelectConversation(conversation)}
                className={cn(
                  "w-full text-left p-3 hover:bg-gray-50 transition-colors border-l-2",
                  selectedConversationId === conversation.id
                    ? "border-l-blue-600 bg-blue-50"
                    : "border-l-transparent"
                )}
              >
                <div className="flex items-start justify-between mb-1">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-900 truncate">
                        {conversation.customerName}
                      </h3>
                      {conversation.isOnline && (
                        <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate">
                      {conversation.customerEmail}
                    </p>
                  </div>
                  {conversation.unreadCount && conversation.unreadCount > 0 && (
                    <Badge className="ml-2 flex-shrink-0" variant="default">
                      {conversation.unreadCount}
                    </Badge>
                  )}
                </div>

                {conversation.lastMessage && (
                  <>
                    <p className="text-sm text-gray-600 truncate">
                      {conversation.lastMessage}
                    </p>
                    {conversation.lastMessageTime && (
                      <p className="text-xs text-gray-400 mt-1">
                        {formatDistanceToNow(new Date(conversation.lastMessageTime), {
                          addSuffix: true,
                        })}
                      </p>
                    )}
                  </>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {conversations.length > 0 && (
        <div className="border-t border-gray-200 p-3 bg-gray-50">
          <p className="text-xs text-gray-500">
            {conversations.length} conversation{conversations.length !== 1 ? "s" : ""}
          </p>
        </div>
      )}
    </div>
  )
}
