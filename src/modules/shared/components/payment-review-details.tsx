"use client"

import { useState } from "react"
import { Banknote, Eye, FileImage, FileText } from "lucide-react"
import { Button } from "./ui/button"
import { isPaymentProofImage, PaymentProofPreview, PaymentProofRow } from "./payment-proof-preview"
import { cn } from "../lib/utils"

interface PaymentReviewDetailsProps {
  proofUrl?: string | null
  fileName?: string
  paymentMethod?: string
  reviewNote: string
  cashDescription?: string
}

/** Shared by admin and client: both outer cards stretch, with content at top. */
export function PaymentReviewDetails({
  proofUrl,
  fileName,
  paymentMethod,
  reviewNote,
  cashDescription = "No uploaded proof is required for cash payments made at the office.",
}: PaymentReviewDetailsProps) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [openingError, setOpeningError] = useState("")
  const label = fileName || "Payment proof"
  const hasImage = isPaymentProofImage(proofUrl)
  const isCash = /cash|office|onsite/i.test(paymentMethod || "")

  const openInNewTab = async () => {
    if (!proofUrl) return
    setOpeningError("")
    if (proofUrl.startsWith("data:")) {
      // Open synchronously while the click still grants popup permission.
      const tab = window.open("about:blank", "_blank")
      if (!tab) {
        setOpeningError("Allow a new tab to open this proof, or use the preview.")
        return
      }
      tab.opener = null
      try {
        const blob = await fetch(proofUrl).then((response) => response.blob())
        const objectUrl = URL.createObjectURL(blob)
        tab.location.href = objectUrl
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
      } catch {
        tab.close()
        setPreviewOpen(true)
      }
      return
    }
    window.open(proofUrl, "_blank", "noopener,noreferrer")
  }

  const cardClass = "min-w-0 rounded-2xl border p-4 text-left [overflow-wrap:anywhere]"
  const headingClass = "mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-900"
  return (
    <div className="min-w-0 [container-type:inline-size]">
      <div className="grid grid-cols-1 items-stretch gap-4 [@container(min-width:28rem)]:grid-cols-2">
        <section aria-label="Payment Proof" className={cn(cardClass, "border-slate-200 bg-slate-50")}>
          <h4 className={headingClass}>Payment Proof</h4>
          {isCash ? (
            <div className="space-y-2 text-sm text-slate-600">
              <Banknote className="h-8 w-8 text-emerald-600" aria-hidden="true" />
              <p className="font-bold text-slate-900">Cash Payment at Office</p>
              <p className="text-xs leading-5">{cashDescription}</p>
            </div>
          ) : hasImage && proofUrl ? (
            <div className="space-y-3">
              <PaymentProofRow proofUrl={proofUrl} fileName={label} onPreview={() => setPreviewOpen(true)} />
              <Button
                type="button"
                variant="outline"
                onClick={openInNewTab}
                className="h-auto min-h-10 w-full whitespace-normal rounded-xl border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 focus-visible:ring-orange-500"
              >
                <Eye className="mr-1.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Open proof in new tab
              </Button>
              {openingError && <p role="status" className="text-xs leading-5 text-slate-600">{openingError}</p>}
            </div>
          ) : proofUrl ? (
            <div className="space-y-2 text-sm text-slate-600">
              <FileText className="h-8 w-8 text-slate-400" aria-hidden="true" />
              <p className="font-bold text-slate-900">Unsupported proof format</p>
              <p className="text-xs leading-5">Payment proof must be a JPG, JPEG, PNG, or WEBP image.</p>
            </div>
          ) : (
            <div className="space-y-2 text-sm text-slate-600">
              <FileImage className="h-8 w-8 text-slate-400" aria-hidden="true" />
              <p className="font-bold text-slate-900">No proof uploaded</p>
              <p className="text-xs leading-5">No proof image is on file for this payment submission.</p>
            </div>
          )}
        </section>

        <section
          aria-label="Review Note"
          className={cn(cardClass, reviewNote ? "border-amber-100 bg-amber-50" : "border-slate-200 bg-slate-50")}
        >
          <h4 className={headingClass}>Review Note</h4>
          <p className={cn("whitespace-pre-wrap text-sm font-medium leading-6", reviewNote ? "text-amber-950" : "text-slate-600")}>
            {reviewNote || "No review note for this payment."}
          </p>
        </section>
      </div>

      <PaymentProofPreview open={previewOpen && hasImage} onOpenChange={setPreviewOpen} proofUrl={proofUrl} fileName={label} />
    </div>
  )
}
