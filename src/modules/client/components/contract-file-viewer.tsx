"use client"

import { useEffect, useRef, useState } from "react"
import { X, Download, AlertCircle, Loader2 } from "lucide-react"
import { renderAsync } from "docx-preview"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogClose,
} from "@/src/modules/shared/components/ui/dialog"
import { Button } from "@/src/modules/shared/components/ui/button"
import type { ContractFile } from "@/src/modules/admin/contexts/cms-context"
import { isPDF, isImage, isDOCX } from "@/src/modules/shared/lib/file-utils"

export function ContractFileViewer({
  open,
  onClose,
  file,
  label,
}: {
  open: boolean
  onClose: () => void
  file: ContractFile | null
  label?: string
}) {
  const docxContainerRef = useRef<HTMLDivElement>(null)
  const [docxLoading, setDocxLoading] = useState(false)
  const [docxError, setDocxError] = useState(false)

  const hasFile = file && file.fileUrl

  useEffect(() => {
    if (!open || !hasFile || !isDOCX(file.fileType)) return

    setDocxLoading(true)
    setDocxError(false)

    const loadDocx = async () => {
      try {
        const response = await fetch(file.fileUrl)
        const blob = await response.blob()
        if (docxContainerRef.current) {
          docxContainerRef.current.innerHTML = ""
          await renderAsync(blob, docxContainerRef.current)
        }
      } catch {
        setDocxError(true)
      } finally {
        setDocxLoading(false)
      }
    }

    loadDocx()
  }, [open, hasFile, file?.fileUrl, file?.fileType])

  if (!hasFile) return null

  const handleDownload = () => {
    const a = document.createElement("a")
    a.href = file.fileUrl
    a.download = file.fileName || "contract"
    a.click()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[90dvh] w-[95vw] sm:max-w-2xl flex-col gap-0 overflow-hidden rounded-2xl border-0 bg-white p-0 shadow-xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 bg-white px-4 pt-4 pb-3 sm:px-6 sm:pt-6 sm:pb-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">
              Contract Preview
            </p>
            <DialogTitle className="mt-1 truncate text-lg font-black text-slate-900">
              {file.fileName}
            </DialogTitle>
            {label && (
              <p className="text-[11px] font-medium text-slate-500">{label}</p>
            )}
          </div>
          <DialogClose asChild>
            <button
              type="button"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogClose>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden max-h-[90dvh] px-4 py-4 sm:px-6 sm:py-5">
          {isPDF(file.fileType) ? (
            <iframe
              src={file.fileUrl}
              className="h-[50vh] w-full rounded-lg border border-slate-200 sm:h-[60vh] md:h-[70vh]"
              title="Contract PDF"
            />
          ) : isImage(file.fileType) ? (
            <div className="flex items-center justify-center overflow-x-hidden">
              <img
                src={file.fileUrl}
                alt="Contract"
                className="max-h-[50vh] w-auto max-w-full rounded-lg object-contain sm:max-h-[60vh] md:max-h-[70vh]"
              />
            </div>
          ) : isDOCX(file.fileType) ? (
            <div className="flex items-center justify-center">
              {docxLoading && (
                <div className="flex flex-col items-center gap-3 py-10 sm:py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
                  <p className="text-sm font-semibold text-slate-500">Loading document...</p>
                </div>
              )}
              {docxError && (
                <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-6 text-center sm:p-12">
                  <AlertCircle className="mb-3 h-12 w-12 text-amber-500" />
                  <h3 className="text-lg font-black text-slate-700">
                    Preview is not available for this file type.
                  </h3>
                </div>
              )}
              <div
                ref={docxContainerRef}
                className={docxLoading || docxError ? "hidden" : "w-full max-w-full overflow-x-auto [&_.docx-wrapper]:max-w-full [&_.docx-wrapper>img]:max-w-full [&_.docx-wrapper>img]:h-auto [&_.docx-wrapper_table]:max-w-full"}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-6 text-center sm:p-12">
              <AlertCircle className="mb-3 h-12 w-12 text-amber-500" />
              <h3 className="text-lg font-black text-slate-700">
                Preview is not available for this file type.
              </h3>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50/50 px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
          <Button
            type="button"
            onClick={handleDownload}
            className="h-11 w-full sm:w-auto rounded-xl bg-orange-600 px-5 text-xs font-bold text-white hover:bg-orange-700"
          >
            <Download className="mr-1.5 h-4 w-4" /> Download Contract
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
