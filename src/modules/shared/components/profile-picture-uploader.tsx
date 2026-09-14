"use client"

import { useRef, useState } from "react"
import { Camera, Trash2, AlertCircle } from "lucide-react"
const PROFILE_PICTURE_MAX_BYTES = 2 * 1024 * 1024

function isValidImageFile(file: File): { ok: boolean; reason?: string } {
  if (!file) return { ok: false, reason: "No file selected." }
  if (!file.type.startsWith("image/")) {
    return { ok: false, reason: "Please select an image file only." }
  }
  if (file.size > PROFILE_PICTURE_MAX_BYTES) {
    return { ok: false, reason: "Image must be smaller than 2MB." }
  }
  return { ok: true }
}
import { ImageCropper } from "@/src/modules/shared/components/image-cropper"

interface ProfilePictureUploaderProps {
  value: string
  fallbackName: string
  onChange: (dataUrl: string | null) => void
  onError?: (message: string) => void
  size?: "sm" | "md" | "lg"
  label?: string
}

const AVATAR_SIZE_MAP = {
  sm: "h-20 w-20",
  md: "h-28 w-28",
  lg: "h-32 w-32",
}

export function ProfilePictureUploader({
  value,
  fallbackName,
  onChange,
  onError,
  size = "md",
  label,
}: ProfilePictureUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [cropOpen, setCropOpen] = useState(false)
  const [pendingImage, setPendingImage] = useState<string>("")

  const handleFile = async (file?: File | null) => {
    setLocalError(null)
    if (!file) return
    const validation = isValidImageFile(file)
    if (!validation.ok) {
      const reason = validation.reason || "Please select a valid image file."
      setLocalError(reason)
      onError?.(reason)
      return
    }
    setIsLoading(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ""))
        reader.onerror = () => reject(new Error("Failed to read file."))
        reader.readAsDataURL(file)
      })
      setPendingImage(dataUrl)
      setCropOpen(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to read the file."
      setLocalError(message)
      onError?.(message)
    } finally {
      setIsLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const handleCrop = (croppedDataUrl: string) => {
    onChange(croppedDataUrl)
    setPendingImage("")
  }

  const handleCropClose = () => {
    setCropOpen(false)
    setPendingImage("")
  }

  const handleRemove = () => {
    onChange(null)
    setLocalError(null)
  }

  const initials = (fallbackName?.charAt(0) || "U").toUpperCase()
  const avatarSizeClass = AVATAR_SIZE_MAP[size]
  const textSizeClass = size === "sm" ? "text-2xl" : "text-3xl"

  return (
    <>
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          {value ? (
            <div className={`${avatarSizeClass} overflow-hidden rounded-full ring-4 ring-white shadow-md`}>
              <img
                src={value}
                alt={fallbackName}
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
            <div className={`${avatarSizeClass} flex items-center justify-center rounded-full bg-gradient-to-br from-slate-100 to-slate-200 ${textSizeClass} font-black uppercase text-slate-600 ring-4 ring-white shadow-md`}>
              {initials}
            </div>
          )}

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-white shadow-md ring-2 ring-white transition hover:bg-slate-700 disabled:opacity-60"
            aria-label="Upload profile picture"
          >
            <Camera className="h-4 w-4" />
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            className="hidden"
            onChange={(event) => handleFile(event.target.files?.[0])}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            {value ? "Change Photo" : "Upload Photo"}
          </button>
          {value && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={isLoading}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-lg px-3 text-xs font-bold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
          )}
        </div>

        {label && (
          <p className="text-xs font-bold text-slate-700">{label}</p>
        )}
        <p className="text-[10px] font-medium text-slate-400">
          JPG, PNG, or WEBP · max {Math.round(PROFILE_PICTURE_MAX_BYTES / 1024 / 1024)}MB
        </p>

        {localError && (
          <div className="flex w-full max-w-xs items-start gap-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>{localError}</p>
          </div>
        )}
      </div>

      <ImageCropper
        open={cropOpen}
        imageUrl={pendingImage}
        onCrop={handleCrop}
        onClose={handleCropClose}
      />
    </>
  )
}
