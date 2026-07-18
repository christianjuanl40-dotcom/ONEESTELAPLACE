"use client"

import type { ReactNode } from "react"

type StatusType =
  | "published" | "hidden" | "draft" | "needs-photo"
  | "consent-missing" | "consent-confirmed" | "featured"
  | "needs-review" | "complete" | "missing" | "live" | "empty"

const STATUS_STYLES: Record<StatusType, string> = {
  published: "bg-emerald-100 text-emerald-700",
  hidden: "bg-slate-100 text-slate-500",
  draft: "bg-amber-100 text-amber-700",
  "needs-photo": "bg-rose-100 text-rose-700",
  "consent-missing": "bg-rose-100 text-rose-700",
  "consent-confirmed": "bg-emerald-100 text-emerald-700",
  featured: "bg-orange-100 text-orange-700",
  "needs-review": "bg-amber-100 text-amber-700",
  complete: "bg-emerald-100 text-emerald-700",
  missing: "bg-rose-100 text-rose-700",
  live: "bg-emerald-100 text-emerald-700",
  empty: "bg-slate-100 text-slate-500",
}

const STATUS_LABELS: Record<StatusType, string> = {
  published: "Published", hidden: "Hidden", draft: "Draft",
  "needs-photo": "Needs Photo", "consent-missing": "Consent Missing",
  "consent-confirmed": "Consent Confirmed", featured: "Featured",
  "needs-review": "Needs Review", complete: "Complete", missing: "Missing",
  live: "Live on Landing", empty: "Empty",
}

export function CMSStatusBadge({ status }: { status: StatusType }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-tight ${STATUS_STYLES[status] || STATUS_STYLES.draft}`}
    >
      {STATUS_LABELS[status] || status}
    </span>
  )
}

export function EmptyState({ icon, title, description, action }: {
  icon: ReactNode; title: string; description: string; action?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 py-10 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm">
        {icon}
      </div>
      <h3 className="text-base font-black text-slate-700">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-xs text-sm font-medium leading-5 text-slate-500">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
