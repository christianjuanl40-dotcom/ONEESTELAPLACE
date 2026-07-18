"use client"

import type React from "react"

import { useState, useRef } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/src/modules/shared/components/ui/dialog"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Input } from "@/src/modules/shared/components/ui/input"
import { Label } from "@/src/modules/shared/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/modules/shared/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/src/modules/shared/components/ui/card"
import { Badge } from "@/src/modules/shared/components/ui/badge"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import { usePaymentProof } from "@/components/payment-proof-context"
import { useBookings } from "@/src/modules/client/contexts/booking-context"
import { Upload, FileImage, X, CheckCircle, AlertCircle, Clock } from "lucide-react"
import { cn } from "@/src/modules/shared/lib/utils"

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

interface PaymentProofUploadProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookingId: string
}

export function PaymentProofUpload({ open, onOpenChange, bookingId }: PaymentProofUploadProps) {
  const { toast } = useToast()
  const { uploadPaymentProof, getPaymentProofByBooking } = usePaymentProof()
  const { getBookingById, submitPayment, modifyBooking } = useBookings()
  const [isUploading, setIsUploading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [paymentDetails, setPaymentDetails] = useState({
    paymentMethod: "",
    paymentAmount: "",
    paymentDate: "",
    paymentReference: "",
  })

  const booking = getBookingById(bookingId)
  const existingProof = getPaymentProofByBooking(bookingId)

  const handleFileSelect = (file: File) => {
    // Validate file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please select a file smaller than 10MB",
        variant: "destructive",
      })
      return
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp", "application/pdf"]
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Please upload an image (JPG, PNG, GIF, WebP) or PDF file",
        variant: "destructive",
      })
      return
    }

    setSelectedFile(file)
  }

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0])
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelect(e.target.files[0])
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!selectedFile) {
      toast({
        title: "No file selected",
        description: "Please select a payment proof file to upload",
        variant: "destructive",
      })
      return
    }

    if (!paymentDetails.paymentMethod || !paymentDetails.paymentAmount || !paymentDetails.paymentDate) {
      toast({
        title: "Missing payment details",
        description: "Please fill in all required payment information",
        variant: "destructive",
      })
      return
    }

    setIsUploading(true)

    try {
      // 1. FIRST: Update BookingContext / oneestela_global_bookings_v2 (single source of truth)
      const method = paymentDetails.paymentMethod === "cash" ? "cash" : "bank";
      const proofDataUrl = method === "bank" && selectedFile ? await fileToDataUrl(selectedFile) : undefined;

      submitPayment(bookingId, {
        type: "full",
        method,
        proof: proofDataUrl,
        bankReferenceNumber: paymentDetails.paymentReference || undefined,
        amount: Number(paymentDetails.paymentAmount) || undefined,
      });

      // 2. THEN: Also append to PaymentProofContext proof log
      uploadPaymentProof(bookingId, selectedFile, paymentDetails)

      toast({
        title: "Payment proof uploaded successfully",
        description: "Your payment proof has been submitted for review. We'll verify it within 24 hours.",
      })

      // Reset form
      setSelectedFile(null)
      setPaymentDetails({
        paymentMethod: "",
        paymentAmount: "",
        paymentDate: "",
        paymentReference: "",
      })

      onOpenChange(false)
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      })
    } finally {
      setIsUploading(false)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes"
    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "verified":
        return <CheckCircle className="h-5 w-5 text-green-500" />
      case "rejected":
        return <AlertCircle className="h-5 w-5 text-red-500" />
      case "pending":
      default:
        return <Clock className="h-5 w-5 text-yellow-500" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "verified":
        return "bg-green-100 text-green-800"
      case "rejected":
        return "bg-red-100 text-red-800"
      case "pending":
      default:
        return "bg-yellow-100 text-yellow-800"
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-2xl overflow-y-auto max-h-[90dvh] rounded-2xl">
        <DialogHeader>
          <DialogTitle>Payment Proof Upload</DialogTitle>
          <DialogDescription>Upload proof of payment for your booking: {booking?.eventName}</DialogDescription>
        </DialogHeader>

        {existingProof ? (
          // Show existing payment proof status
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                {getStatusIcon(existingProof.status)}
                <span>Payment Proof Status</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">Status:</span>
                <Badge className={getStatusColor(existingProof.status)}>
                  {existingProof.status.charAt(0).toUpperCase() + existingProof.status.slice(1)}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium">Payment Method:</span>
                  <p className="text-gray-600">{existingProof.paymentMethod}</p>
                </div>
                <div>
                  <span className="font-medium">Amount:</span>
                  <p className="text-gray-600">{existingProof.paymentAmount}</p>
                </div>
                <div>
                  <span className="font-medium">Payment Date:</span>
                  <p className="text-gray-600">{new Date(existingProof.paymentDate || existingProof.submittedAt).toLocaleDateString()}</p>
                </div>
                <div>
                  <span className="font-medium">Uploaded:</span>
                  <p className="text-gray-600">{new Date(existingProof.uploadedAt || existingProof.submittedAt).toLocaleDateString()}</p>
                </div>
              </div>

              {existingProof.paymentReference && (
                <div>
                  <span className="font-medium">Reference:</span>
                  <p className="text-gray-600">{existingProof.paymentReference}</p>
                </div>
              )}

              <div className="flex items-center space-x-2">
                <FileImage className="h-4 w-4" />
                <span className="text-sm">{existingProof.fileName}</span>
                <span className="text-xs text-gray-500">({formatFileSize(existingProof.fileSize ?? 0)})</span>
              </div>

              {existingProof.adminNote && (
                <div className="bg-gray-50 p-3 rounded-lg">
                  <span className="font-medium text-sm">Admin Note:</span>
                  <p className="text-sm text-gray-600 mt-1">{existingProof.adminNote}</p>
                </div>
              )}

              {existingProof.status === "rejected" && (
                <div className="bg-red-50 p-4 rounded-lg">
                  <p className="text-sm text-red-800">
                    Your payment proof was rejected. Please upload a new, clearer image of your payment receipt or
                    screenshot.
                  </p>
                  <Button
                    className="mt-2"
                    onClick={() => {
                      // Allow re-upload by clearing existing proof (in real app, you might want to keep history)
                      setSelectedFile(null)
                    }}
                  >
                    Upload New Proof
                  </Button>
                </div>
              )}

              {existingProof.status === "verified" && (
                <div className="bg-green-50 p-4 rounded-lg">
                  <p className="text-sm text-green-800">
                    ✅ Your payment has been verified! Your booking status will be updated to confirmed shortly.
                  </p>
                </div>
              )}

              {existingProof.status === "pending" && (
                <div className="bg-yellow-50 p-4 rounded-lg">
                  <p className="text-sm text-yellow-800">
                    ⏳ Your payment proof is being reviewed. We'll notify you once it's verified (usually within 24
                    hours).
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          // Show upload form
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* File Upload Area */}
            <div className="space-y-4">
              <Label className="text-[10px] font-black uppercase tracking-[0.2em]">Payment Proof File *</Label>
              <div
                className={cn(
                  "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
                  dragActive ? "border-blue-500 bg-blue-50" : "border-gray-300",
                  selectedFile && "border-green-500 bg-green-50",
                )}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                {selectedFile ? (
                  <div className="space-y-2">
                    <FileImage className="h-12 w-12 mx-auto text-green-500" />
                    <div>
                      <p className="font-medium">{selectedFile.name}</p>
                      <p className="text-sm text-gray-500">{formatFileSize(selectedFile.size)}</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => setSelectedFile(null)}>
                      <X className="h-4 w-4 mr-2" />
                      Remove
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="h-12 w-12 mx-auto text-gray-400" />
                    <div>
                      <p className="text-lg font-medium">Drop your payment proof here</p>
                      <p className="text-sm text-gray-500">or click to browse files</p>
                    </div>
                    <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                      Choose File
                    </Button>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                onChange={handleFileInputChange}
                className="hidden"
              />
              <p className="text-xs text-gray-500">Supported formats: JPG, PNG, GIF, WebP, PDF. Maximum size: 10MB</p>
            </div>

            {/* Payment Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="paymentMethod" className="text-[10px] font-black uppercase tracking-[0.2em]">Payment Method *</Label>
                <Select
                  value={paymentDetails.paymentMethod}
                  onValueChange={(value) => setPaymentDetails((prev) => ({ ...prev, paymentMethod: value }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select payment method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank-transfer">Bank Transfer</SelectItem>
                    <SelectItem value="credit-card">Credit Card</SelectItem>
                    <SelectItem value="debit-card">Debit Card</SelectItem>
                    <SelectItem value="paypal">PayPal</SelectItem>
                    <SelectItem value="gcash">GCash</SelectItem>
                    <SelectItem value="paymaya">PayMaya</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="paymentAmount" className="text-[10px] font-black uppercase tracking-[0.2em]">Payment Amount *</Label>
                <Input
                  id="paymentAmount"
                  placeholder="₱0.00"
                  value={paymentDetails.paymentAmount}
                  onChange={(e) => setPaymentDetails((prev) => ({ ...prev, paymentAmount: e.target.value }))}
                  required
                  className="h-11 w-full"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="paymentDate" className="text-[10px] font-black uppercase tracking-[0.2em]">Payment Date *</Label>
                <Input
                  id="paymentDate"
                  type="date"
                  value={paymentDetails.paymentDate}
                  onChange={(e) => setPaymentDetails((prev) => ({ ...prev, paymentDate: e.target.value }))}
                  required
                  className="h-11 w-full"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="paymentReference" className="text-[10px] font-black uppercase tracking-[0.2em]">Reference Number (Optional)</Label>
                <Input
                  id="paymentReference"
                  placeholder="Transaction ID, Check #, etc."
                  value={paymentDetails.paymentReference}
                  onChange={(e) => setPaymentDetails((prev) => ({ ...prev, paymentReference: e.target.value }))}
                  className="h-11 w-full"
                />
              </div>
            </div>

            {/* Submit Button */}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="w-full sm:w-auto h-11" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" className="w-full sm:w-auto h-11" disabled={isUploading || !selectedFile}>
                {isUploading ? "Uploading..." : "Submit Payment Proof"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
