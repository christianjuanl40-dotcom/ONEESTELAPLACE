"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, Download, FileText, ImageIcon, Loader2, Save, Trash2, X } from "lucide-react"
import { Button } from "@shared/components/ui/button"
import { useToast } from "@shared/hooks/use-toast"
import { useCMS, type ContractFile } from "@admin/contexts/cms-context"
import { CMSSectionHeader } from "./cms-section-header"
import { ContractFileViewer } from "@/src/modules/client/components/contract-file-viewer"
import { isImage, isPDF } from "@/src/modules/shared/lib/file-utils"
import { getAuthHeaders } from "@/src/modules/shared/lib/auth-token"

type AvailableContract = {
  fileName: string
  fileType: string
  fileUrl: string
  lastModified: number
}

function formatDate(ms: number) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date(ms))
  } catch {
    return ""
  }
}

function getFileIcon(fileType: string) {
  if (isImage(fileType)) return <ImageIcon className="h-5 w-5 text-purple-500" />
  return <FileText className="h-5 w-5 text-red-500" />
}

function FileUploader({
  label,
  category,
  contract,
  onChange,
}: {
  label: string
  category: "venue" | "office"
  contract: { fileName: string; fileType: string; fileUrl: string }
  onChange: (data: ContractFile) => void
}) {
  const { toast } = useToast()
  const [available, setAvailable] = useState<AvailableContract[]>([])
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const fetchAvailable = useCallback(async () => {
    setLoading(true)
    setFetchError(false)
    try {
      const res = await fetch(`/api/contracts?category=${category}`, {
        headers: await getAuthHeaders(),
      })
      const json = await res.json()
      setAvailable(json.contracts?.[category] || [])
    } catch {
      setFetchError(true)
    } finally {
      setLoading(false)
    }
  }, [category])

  useEffect(() => {
    fetchAvailable()
  }, [fetchAvailable])

  const handleSelect = (file: AvailableContract) => {
    onChange({
      fileName: file.fileName,
      fileType: file.fileType,
      fileUrl: file.fileUrl,
    })
  }

  const handleRemove = () => {
    onChange({ fileName: "", fileType: "", fileUrl: "" })
  }

  const isSelectedFileMissing =
    contract.fileUrl &&
    !contract.fileUrl.startsWith("data:") &&
    available.length > 0 &&
    !available.some((a) => a.fileUrl === contract.fileUrl)

  const fileTypeLabel = isImage(contract.fileType)
    ? "Image"
    : isPDF(contract.fileType)
      ? "PDF"
      : "DOCX"

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-black text-slate-900">{label}</h3>
      </div>
      <div className="p-4">
        {contract.fileUrl ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              {getFileIcon(contract.fileType)}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-900">{contract.fileName}</p>
                <p className="text-[10px] font-semibold text-slate-500">{fileTypeLabel}</p>
                {(() => {
                  const match = available.find((a) => a.fileUrl === contract.fileUrl)
                  if (match?.lastModified) {
                    return (
                      <p className="mt-0.5 text-[10px] font-medium text-slate-400">
                        Updated: {formatDate(match.lastModified)}
                      </p>
                    )
                  }
                  return null
                })()}
              </div>
            </div>
            {isSelectedFileMissing && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-600">
                This file no longer exists in public/contracts/{category}/. Select a different contract below.
              </p>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowPreview(true)}
                className="h-8 flex-1 rounded-lg border-slate-200 text-[10px] font-bold"
              >
                <FileText className="mr-1 h-3 w-3" /> Preview
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const a = document.createElement("a")
                  a.href = contract.fileUrl
                  a.download = contract.fileName
                  a.click()
                }}
                className="h-8 flex-1 rounded-lg border-slate-200 text-[10px] font-bold"
              >
                <Download className="mr-1 h-3 w-3" /> Download
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRemove}
                className="h-8 rounded-lg border-rose-200 text-[10px] font-bold text-rose-600 hover:bg-rose-50"
              >
                <Trash2 className="mr-1 h-3 w-3" /> Remove
              </Button>
            </div>
          </div>
        ) : null}

        <ContractFileViewer
          open={showPreview}
          onClose={() => setShowPreview(false)}
          file={contract}
          label={label}
        />

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6">
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            <p className="text-xs font-semibold text-slate-400">Loading available contracts...</p>
          </div>
        ) : fetchError ? (
          <div className="rounded-lg border-2 border-dashed border-rose-200 bg-rose-50/50 p-4 text-center">
            <p className="text-xs font-semibold text-rose-600">Failed to load available contracts.</p>
            <button
              type="button"
              onClick={fetchAvailable}
              className="mt-2 text-xs font-bold text-orange-600 underline underline-offset-2 hover:text-orange-700"
            >
              Retry
            </button>
          </div>
        ) : available.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 p-4 text-center">
            <p className="text-xs font-semibold text-slate-500">
              No contract files found in public/contracts/{category}/.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
              Available Contracts
            </p>
            <div className="space-y-1">
              {available.map((file) => {
                const isActive = contract.fileUrl === file.fileUrl
                return (
                  <button
                    key={file.fileUrl}
                    type="button"
                    onClick={() => handleSelect(file)}
                    className={[
                      "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition",
                      isActive
                        ? "border-orange-300 bg-orange-50 ring-1 ring-orange-300"
                        : "border-slate-200 bg-white hover:border-orange-200 hover:bg-orange-50/30",
                    ].join(" ")}
                  >
                    {getFileIcon(file.fileType)}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-900">{file.fileName}</p>
                      <div className="flex items-center gap-2">
                        <p className="text-[10px] font-semibold text-slate-500">
                          {isImage(file.fileType)
                            ? "Image"
                            : isPDF(file.fileType)
                              ? "PDF"
                              : "DOCX"}
                        </p>
                        {isActive && (
                          <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-orange-700">
                            Current
                          </span>
                        )}
                      </div>
                      {file.lastModified ? (
                        <p className="mt-0.5 text-[10px] font-medium text-slate-400">
                          Updated: {formatDate(file.lastModified)}
                        </p>
                      ) : null}
                    </div>
                    {isActive && (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-600">
                        <Check className="h-3 w-3 text-white" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function CMSContractsTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { cmsData, saveCMSData } = useCMS()
  const [eventVenueContract, setEventVenueContract] = useState(cmsData.eventVenueContract)
  const [officeRentalContract, setOfficeRentalContract] = useState(cmsData.officeRentalContract)

  useEffect(() => {
    setEventVenueContract(cmsData.eventVenueContract)
    setOfficeRentalContract(cmsData.officeRentalContract)
  }, [cmsData.eventVenueContract, cmsData.officeRentalContract])

  const handleSave = () => {
    saveCMSData({
      ...cmsData,
      eventVenueContract,
      officeRentalContract,
    })
  }

  return (
    <div>
      <CMSSectionHeader
        title="Contract Documents"
        currentSection="contracts"
        onNavigate={onNavigate}
        action={
          <Button
            type="button"
            onClick={handleSave}
            className="h-9 w-full shrink-0 whitespace-nowrap rounded-lg bg-orange-600 px-3.5 text-sm font-bold text-white hover:bg-orange-700 sm:w-auto"
          >
            <Save className="mr-1.5 h-3.5 w-3.5" /> Save Changes
          </Button>
        }
      />

      <div className="grid gap-6 grid-cols-1 sm:grid-cols-2">
        <FileUploader
          label="Event Venue Contract"
          category="venue"
          contract={eventVenueContract}
          onChange={setEventVenueContract}
        />
        <FileUploader
          label="Office Rental Contract"
          category="office"
          contract={officeRentalContract}
          onChange={setOfficeRentalContract}
        />
      </div>
    </div>
  )
}
