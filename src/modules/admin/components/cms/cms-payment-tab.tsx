"use client"

import { useState } from "react"
import { useCMS } from "../../contexts/cms-context"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Input } from "@/src/modules/shared/components/ui/input"
import { Textarea } from "@/src/modules/shared/components/ui/textarea"
import { Label } from "@/src/modules/shared/components/ui/label"
import { CMSSectionHeader } from "./cms-section-header"
import { CMSImageUpload } from "./cms-image-upload"
import { Building2, Save } from "lucide-react"

export function CMSPaymentTab({ onNavigate }: { onNavigate: (key: string) => void }) {
  const { paymentInfo, updatePaymentInfo } = useCMS()

  const [bankName, setBankName] = useState(paymentInfo.bankName)
  const [accountName, setAccountName] = useState(paymentInfo.accountName)
  const [accountNumber, setAccountNumber] = useState(paymentInfo.accountNumber)
  const [instructions, setInstructions] = useState(paymentInfo.instructions)
  const [qrCodeUrl, setQrCodeUrl] = useState(paymentInfo.qrCodeUrl || "")

  const handleSave = () => {
    updatePaymentInfo({ bankName, accountName, accountNumber, instructions, qrCodeUrl })
  }

  return (
    <div>
      <CMSSectionHeader
        title="Payment Settings"
        description="Manage bank account details shown on payment pages."
        currentSection="payment"
        onNavigate={onNavigate}
        action={
          <Button
            onClick={handleSave}
            className="h-11 rounded-lg bg-orange-600 text-xs font-bold text-white hover:bg-orange-700 w-full sm:w-auto"
          >
            <Save className="mr-1.5 h-3.5 w-3.5" />
            Save Payment Settings
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Bank Name</Label>
            <Input
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="e.g. BDO, GCash, Maya"
              className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm"
            />
          </div>

          <div>
            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Account Name</Label>
            <Input
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="e.g. One Estela Place"
              className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm"
            />
          </div>

          <div>
            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Account Number</Label>
            <Input
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="e.g. 0012 3456 7890"
              className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm"
            />
          </div>

          <div>
            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Payment Instructions (Optional)</Label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Please upload a clear screenshot of your bank transfer receipt."
              className="mt-1 w-full min-h-[80px] resize-none rounded-lg border border-slate-200 px-4 py-3 text-sm"
            />
          </div>

          <div className="pt-1">
            <CMSImageUpload
              label="Bank Transfer QR Code"
              value={qrCodeUrl}
              storagePath="cms/payment"
              note="Shown on client Bank Transfer payment pages. If empty, the default QR image is used."
              onValueChange={setQrCodeUrl}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
              <Building2 className="h-4 w-4" />
            </div>
            <p className="text-sm font-black text-slate-900">Preview</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <div className="space-y-3">
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="font-semibold text-slate-500">Bank</span>
                <span className="font-bold text-slate-900">{bankName || "—"}</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="font-semibold text-slate-500">Account Name</span>
                <span className="font-bold text-slate-900">{accountName || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-slate-500">Account No.</span>
                <span className="font-bold text-slate-900">{accountNumber || "—"}</span>
              </div>
            </div>
            {instructions && (
              <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">{instructions}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
