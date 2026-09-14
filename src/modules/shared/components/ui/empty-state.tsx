import type React from "react"
import { LucideIcon } from "lucide-react"

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: React.ReactNode
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-8 text-center animate-in fade-in duration-500">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-50 mb-4">
        <Icon className="h-10 w-10 text-blue-500" />
      </div>
      <h3 className="mb-2 text-xl font-semibold text-gray-900">{title}</h3>
      <p className="mb-6 max-w-sm text-sm text-gray-500">{description}</p>
      {action && <div>{action}</div>}
    </div>
  )
}