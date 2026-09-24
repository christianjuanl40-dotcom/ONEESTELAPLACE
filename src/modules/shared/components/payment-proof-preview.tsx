"use client"

import { useState } from "react"
import { FileImage, X } from "lucide-react"

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/src/modules/shared/components/ui/dialog"
import { cn } from "@/src/modules/shared/lib/utils"

export function isPaymentProofImage(value: unknown) {
  const proof = String(value || "").toLowerCase()
  if (!proof) return false
  if (/^data:image\/(?:jpe?g|png|webp);/i.test(proof)) return true
  return /\.(?:jpe?g|png|webp)(?:\?|#|$)/i.test(proof)
}

interface PaymentProofRowProps {
  proofUrl: string
  fileName?: string
  onPreview: () => void
  onRemove?: () => void
  className?: string
}

export function PaymentProofRow({
  proofUrl,
  fileName,
  onPreview,
  onRemove,
  className,
}: PaymentProofRowProps) {
  if (!proofUrl) return null

  const label = fileName || "Payment proof"

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Preview payment proof ${label}`}
      onClick={onPreview}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onPreview()
        }
      }}
      className={cn(
        "group flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 cursor-pointer",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <FileImage className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
        <p className="min-w-0 break-all text-xs font-bold text-emerald-900">{label}</p>
      </div>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove payment proof ${label}`}
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
          onKeyDown={(event) => event.stopPropagation()}
          className="shrink-0 rounded-md p-1 text-emerald-600 transition hover:bg-emerald-200 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

interface PaymentProofPreviewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  proofUrl: string | null | undefined
  fileName?: string
}

export function PaymentProofPreview({
  open,
  onOpenChange,
  proofUrl,
  fileName,
}: PaymentProofPreviewProps) {
  const [failedProofUrl, setFailedProofUrl] = useState<string | null>(null)
  const label = fileName || "Payment proof"
  const imageLoadError = Boolean(proofUrl) && failedProofUrl === proofUrl

  return (
    <Dialog open={open && Boolean(proofUrl)} onOpenChange={onOpenChange}>
      <DialogContent
        plain
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex max-h-[95dvh] w-[calc(100vw-1rem)] max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950 p-0 text-white shadow-2xl sm:w-[calc(100vw-2rem)]"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <DialogTitle className="text-base font-black text-white">Payment Proof</DialogTitle>
            <DialogDescription className="sr-only">Preview of {label}</DialogDescription>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              aria-label="Close payment proof preview"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </DialogClose>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-5">
          {imageLoadError ? (
            <div className="flex min-h-[180px] items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/5 p-6 text-center text-sm font-bold text-white/70">
              Unable to load payment proof.
            </div>
          ) : (
            <img
              src={proofUrl || ""}
              alt={label}
              onError={() => setFailedProofUrl(proofUrl || "")}
              className="mx-auto block h-auto w-auto max-h-[calc(95dvh-8rem)] max-w-full object-contain"
            />
          )}
        </div>

        <p className="shrink-0 border-t border-white/10 px-4 py-3 text-center text-xs font-bold break-all text-white/75 sm:px-5">
          {label}
        </p>
      </DialogContent>
    </Dialog>
  )
}
