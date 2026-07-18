"use client"

import { useCMS } from "@/src/modules/admin/contexts/cms-context"

const DEFAULT_QR_IMAGE = "/images/bank_qr.jpg"

export function BankTransferQR() {
  const { paymentInfo } = useCMS()
  const qrSrc = paymentInfo.qrCodeUrl || DEFAULT_QR_IMAGE

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-center">
      <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
        Bank Transfer QR Code
      </p>
      <div className="flex justify-center">
        <img
          src={qrSrc}
          alt="Bank Transfer QR Code"
          className="w-full max-w-[280px] rounded-xl border border-slate-200 bg-white object-contain shadow-sm"
          onError={(e) => {
            const target = e.currentTarget
            if (target.src !== window.location.origin + DEFAULT_QR_IMAGE) {
              target.src = DEFAULT_QR_IMAGE
            }
          }}
        />
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        Scan this QR code using your banking application to complete your payment.
      </p>
      <p className="mt-1 text-[11px] leading-5 text-slate-400">
        If you cannot scan the QR code, please contact One Estela Place.
      </p>
    </div>
  )
}
