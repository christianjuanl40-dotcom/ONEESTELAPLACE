"use client"

import type { ReactNode } from "react"
import type { CatalogStatus } from "@/src/modules/shared/lib/catalog-status"

type StatusType =
  | CatalogStatus | "hidden" | "draft" | "needs-photo"
  | "consent-missing" | "consent-confirmed" | "featured"
  | "needs-review" | "complete" | "missing" | "live" | "empty"

const STATUS_STYLES: Record<StatusType, string> = {
  published: "border border-emerald-200 bg-emerald-50 text-emerald-700",
  under_renovation: "border border-amber-200 bg-amber-50 text-amber-700",
  hidden: "border border-slate-200 bg-slate-50 text-slate-600",
  draft: "border border-amber-200 bg-amber-50 text-amber-700",
  "needs-photo": "border border-rose-200 bg-rose-50 text-rose-700",
  "consent-missing": "border border-rose-200 bg-rose-50 text-rose-700",
  "consent-confirmed": "border border-emerald-200 bg-emerald-50 text-emerald-700",
  featured: "border border-orange-200 bg-orange-50 text-orange-700",
  "needs-review": "border border-amber-200 bg-amber-50 text-amber-700",
  complete: "border border-emerald-200 bg-emerald-50 text-emerald-700",
  missing: "border border-rose-200 bg-rose-50 text-rose-700",
  live: "border border-emerald-200 bg-emerald-50 text-emerald-700",
  empty: "border border-slate-200 bg-slate-50 text-slate-600",
}

const STATUS_LABELS: Record<StatusType, string> = {
  published: "Published", under_renovation: "Under Renovation", hidden: "Hidden", draft: "Draft",
  "needs-photo": "Needs Photo", "consent-missing": "Consent Missing",
  "consent-confirmed": "Consent Confirmed", featured: "Featured",
  "needs-review": "Needs Review", complete: "Complete", missing: "Missing",
  live: "Live on Landing", empty: "Empty",
}

export function CMSStatusBadge({ status }: { status: StatusType }) {
  return (
    <span
      className={`oe-status-badge ${STATUS_STYLES[status] || STATUS_STYLES.draft}`}
    >
      {STATUS_LABELS[status] || status}
    </span>
  )
}

export function EmptyState({ icon, title, description, action }: {
  icon?: ReactNode; title: string; description?: string; action?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 py-10 text-center">
      {icon && <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm">{icon}</div>}
      <h3 className="text-base font-black text-slate-700">{title}</h3>
      {description && <p className="mx-auto mt-1.5 max-w-xs text-sm font-medium leading-5 text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
