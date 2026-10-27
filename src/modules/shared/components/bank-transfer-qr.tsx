"use client"

import { useCMS } from "@/src/modules/admin/contexts/cms-context"
import { buttonVariants } from "@/src/modules/shared/components/ui/button"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/src/modules/shared/components/ui/dialog"
import { cn } from "@/src/modules/shared/lib/utils"

const DEFAULT_QR_IMAGE = "/images/bank_qr.jpg"

export function BankTransferQR() {
  const { paymentInfo } = useCMS()
  const qrSrc = paymentInfo.qrCodeUrl || DEFAULT_QR_IMAGE
  const fallbackToDefault = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const target = event.currentTarget
    if (target.src !== window.location.origin + DEFAULT_QR_IMAGE) {
      target.src = DEFAULT_QR_IMAGE
    }
  }

  return (
    <section aria-label="Bank transfer QR" className="min-w-0 rounded-xl border border-slate-100 bg-slate-50 p-3 text-center">
      <p className="mb-2 text-xs font-bold text-slate-700">
        Bank Transfer QR Code
      </p>
      <div className="flex justify-center">
        <img
          src={qrSrc}
          alt="Bank Transfer QR Code"
          className="block h-auto w-full max-w-[220px] rounded-lg border border-slate-200 bg-white object-contain"
          onError={fallbackToDefault}
        />
      </div>
      <Dialog>
        <DialogTrigger type="button" className={cn(buttonVariants({ variant: "outline" }), "mt-2 h-9 rounded-lg border-slate-200 px-3 text-xs font-bold")}>
          Enlarge QR code
        </DialogTrigger>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl" aria-describedby={undefined}>
          <DialogTitle className="shrink-0 border-b border-slate-100 px-4 py-3 pr-14 text-base font-bold">
            Bank Transfer QR Code
          </DialogTitle>
          <div className="min-h-0 overflow-y-auto p-3">
            <img
              src={qrSrc}
              alt="Enlarged bank transfer QR code"
              onError={fallbackToDefault}
              className="mx-auto block h-auto w-auto max-h-[calc(90dvh-8rem)] max-w-full object-contain"
            />
          </div>
          <a href={qrSrc} target="_blank" rel="noopener noreferrer" className="shrink-0 border-t border-slate-100 px-4 py-3 text-center text-sm font-semibold text-orange-700 underline">
            Open original QR image
          </a>
        </DialogContent>
      </Dialog>
      <p className="mt-2 text-xs leading-5 text-slate-600">
        Scan this QR code using your banking application to complete your payment.
      </p>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        If you cannot scan the QR code, please contact One Estela Place.
      </p>
    </section>
  )
}
