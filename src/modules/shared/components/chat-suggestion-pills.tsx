"use client"

import { MessageCircle, X } from "lucide-react"
import { Button } from "@/src/modules/shared/components/ui/button"
import type { ChatSuggestion } from "@/src/modules/shared/lib/chat-suggestions"

interface ChatSuggestionPillsProps {
  suggestions: ChatSuggestion[]
  bookingLabel?: string
  onSelect: (suggestion: ChatSuggestion) => void
  onDismiss: () => void
  disabled?: boolean
}

export function ChatSuggestionPills({
  suggestions,
  bookingLabel,
  onSelect,
  onDismiss,
  disabled = false,
}: ChatSuggestionPillsProps) {
  if (suggestions.length === 0) return null

  return (
    <div className="px-4 pt-3 pb-1 sm:px-6" role="group" aria-label="Suggested questions">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Suggested questions</p>
          {bookingLabel && (
            <p className="truncate text-[11px] text-slate-400" title={bookingLabel}>For {bookingLabel}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          disabled={disabled}
          aria-label="Dismiss suggested questions"
          className="rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-500/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <Button
            key={suggestion.id}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onSelect(suggestion)}
            className="h-auto min-h-8 rounded-full border-orange-200 bg-orange-50 px-3 py-1.5 text-left text-xs font-medium text-orange-700 hover:bg-orange-100 hover:text-orange-800 focus-visible:ring-orange-500/50"
          >
            <MessageCircle className="mr-1.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{suggestion.text}</span>
          </Button>
        ))}
      </div>
    </div>
  )
}
