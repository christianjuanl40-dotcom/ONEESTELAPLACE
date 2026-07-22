"use client"

import React, { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { 
  CheckCircle2, Clock, UploadCloud, CreditCard, Banknote, 
  Info, ShieldCheck, FileImage, X, Calendar, MapPin
} from "lucide-react"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Label } from "@/src/modules/shared/components/ui/label"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import { useBookings, Booking } from "@/src/modules/client/contexts/booking-context"
import { useCMS } from "@/src/modules/admin/contexts/cms-context"
import { BankTransferQR } from "@/src/modules/shared/components/bank-transfer-qr"

export default function ClientPaymentPage() {
  const params = useParams()
  const router = useRouter()
  const { toast } = useToast()
  const { bookings, submitPayment } = useBookings()
  const { paymentInfo } = useCMS()
  
  const bookingId = params.bookingId as string
  const [booking, setBooking] = useState<Booking | null>(null)
  
  // Payment States
  const [paymentType, setPaymentType] = useState<"full" | "downpayment">("full")
  const [paymentMethod, setPaymentMethod] = useState<"bank" | "cash">("bank")
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Hanapin yung booking details gamit ang ID sa URL
  useEffect(() => {
    if (bookings.length > 0 && bookingId) {
      const found = bookings.find(b => b.id === bookingId)
      if (found) setBooking(found)
    }
  }, [bookings, bookingId])

  if (!booking) {
    return <div className="min-h-screen flex items-center justify-center font-bold text-slate-500">Loading booking details...</div>
  }

  // Fallback to 0 if totalPrice is undefined, but assuming it exists
  const totalPrice = booking.totalPrice || 15000;
  const dpPct = typeof booking.downPaymentPercentage === "number" && booking.downPaymentPercentage > 0 ? booking.downPaymentPercentage : 50;
  const downpaymentAmount = booking.downPaymentAmount ?? totalPrice * (dpPct / 100);
  const amountToPay = paymentType === "full" ? totalPrice : downpaymentAmount;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setProofFile(e.target.files[0])
    }
  }

  const handleSubmitPayment = () => {
    // Validation
    if (paymentMethod === "bank" && !proofFile) {
        toast({ title: "Proof Required", description: "Please upload your proof of payment for Bank Transfer.", variant: "destructive" })
        return;
    }

    setIsSubmitting(true)

    // Simulating upload delay
    setTimeout(() => {
        // ✨ TATAWAGIN NA NATIN YUNG FUNCTION MULA SA CONTEXT ✨
        submitPayment(booking.id, {
            type: paymentType,
            method: paymentMethod,
            proof: proofFile ? proofFile.name : undefined
        })

        toast({
            title: "Payment Submitted!",
            description: "Your payment is now under review by the admin. Please wait for the confirmation.",
            className: "bg-emerald-500 text-white border-none"
        })

        // I-redirect natin siya pabalik sa client dashboard / list of bookings niya
        router.push("/portal/bookings") 
    }, 1500)
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 sm:py-12 sm:px-6 overflow-x-hidden">
      <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        
        {/* HEADER: PENCIL BOOKING ALERT */}
        <div className="bg-amber-50 border border-amber-200 rounded-[2rem] p-6 md:p-8 flex flex-col md:flex-row gap-6 items-center justify-between shadow-sm">
            <div className="flex items-start gap-5">
                <div className="w-14 h-14 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center shrink-0 shadow-inner">
                    <Clock className="w-7 h-7" />
                </div>
                <div>
                    <h2 className="text-2xl font-black text-amber-900 mb-1.5">Pencil Booking Secured!</h2>
                    <p className="text-sm text-amber-700 leading-relaxed max-w-xl break-words">
                        Your slot is temporarily reserved. Please complete your payment within <strong className="font-black">24 hours</strong> to confirm your booking. Unpaid bookings will automatically be cancelled.
                    </p>
                </div>
            </div>
            <div className="bg-white px-6 sm:px-8 py-4 rounded-2xl border border-amber-100 text-center shrink-0 shadow-sm">
                <p className="text-[10px] font-black text-amber-400 uppercase tracking-[0.2em] mb-1">Time Left</p>
                <p className="text-3xl font-black text-[#ea580c] tracking-tight">23:59:59</p>
            </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* LEFT COLUMN: PAYMENT FORM */}
            <div className="lg:col-span-2 space-y-6">
                
                {/* STEP 1: PAYMENT TYPE */}
                <div className="bg-white rounded-[2rem] border border-slate-200 p-6 md:p-8 shadow-sm">
                    <h3 className="text-xl font-black text-slate-900 mb-6 flex items-center gap-3">
                        <span className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-sm">1</span> 
                        Payment Term
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <button 
                            onClick={() => setPaymentType("full")}
                            className={`p-6 rounded-2xl border-2 text-left transition-all ${paymentType === "full" ? 'border-[#ea580c] bg-orange-50 shadow-md scale-[1.02]' : 'border-slate-100 hover:border-slate-300'}`}
                        >
                            <div className="flex justify-between items-center mb-3">
                                <p className="font-black text-slate-900 text-lg">Full Payment</p>
                                {paymentType === "full" && <CheckCircle2 className="w-6 h-6 text-[#ea580c]" />}
                            </div>
                            <p className="text-3xl font-black text-[#ea580c]">₱{totalPrice.toLocaleString()}</p>
                            <p className="text-xs text-slate-500 mt-2 font-medium">Pay the total amount upfront.</p>
                        </button>

                        <button 
                            onClick={() => setPaymentType("downpayment")}
                            className={`p-6 rounded-2xl border-2 text-left transition-all ${paymentType === "downpayment" ? 'border-[#ea580c] bg-orange-50 shadow-md scale-[1.02]' : 'border-slate-100 hover:border-slate-300'}`}
                        >
                            <div className="flex justify-between items-center mb-3">
                                <p className="font-black text-slate-900 text-lg">Down Payment</p>
                                {paymentType === "downpayment" && <CheckCircle2 className="w-6 h-6 text-[#ea580c]" />}
                            </div>
                            <p className="text-3xl font-black text-[#ea580c]">₱{downpaymentAmount.toLocaleString()}</p>
                            <p className="text-[10px] text-rose-500 mt-2 font-bold bg-rose-50 px-2 py-1 rounded w-fit uppercase tracking-[0.2em] border border-rose-100">Non-Refundable {dpPct}%</p>
                        </button>
                    </div>
                </div>

                {/* STEP 2: PAYMENT METHOD */}
                <div className="bg-white rounded-[2rem] border border-slate-200 p-6 md:p-8 shadow-sm">
                    <h3 className="text-xl font-black text-slate-900 mb-6 flex items-center gap-3">
                        <span className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-sm">2</span> 
                        Payment Method
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                        <button 
                            onClick={() => setPaymentMethod("bank")}
                            className={`p-5 rounded-2xl border-2 flex items-center gap-4 transition-all ${paymentMethod === "bank" ? 'border-[#ea580c] bg-orange-50 shadow-sm' : 'border-slate-100 hover:border-slate-300'}`}
                        >
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${paymentMethod === "bank" ? 'bg-[#ea580c] text-white shadow-inner' : 'bg-slate-100 text-slate-500'}`}>
                                <CreditCard className="w-6 h-6" />
                            </div>
                            <div className="text-left">
                                <p className="font-black text-slate-900 text-base mb-0.5">Bank Transfer</p>
                                <p className="text-xs text-slate-500">BDO, GCash, Maya</p>
                            </div>
                        </button>

                        <button 
                            onClick={() => setPaymentMethod("cash")}
                            className={`p-5 rounded-2xl border-2 flex items-center gap-4 transition-all ${paymentMethod === "cash" ? 'border-[#ea580c] bg-orange-50 shadow-sm' : 'border-slate-100 hover:border-slate-300'}`}
                        >
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${paymentMethod === "cash" ? 'bg-[#ea580c] text-white shadow-inner' : 'bg-slate-100 text-slate-500'}`}>
                                <Banknote className="w-6 h-6" />
                            </div>
                            <div className="text-left">
                                <p className="font-black text-slate-900 text-base mb-0.5">Pay in Cash</p>
                                <p className="text-xs text-slate-500">Pay directly at office</p>
                            </div>
                        </button>
                    </div>

                    {/* METHOD DETAILS & UPLOAD */}
                    {paymentMethod === "bank" ? (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-[0.2em] mb-4">Bank Details</p>
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center gap-2 pb-3 border-b border-slate-200 flex-wrap">
                                        <span className="text-sm font-medium text-slate-600">{paymentInfo.bankName || "BDO"}</span>
                                        <span className="text-base font-black text-slate-900 break-all">{paymentInfo.accountNumber || "0012 3456 7890"}</span>
                                    </div>
                                    <div className="flex justify-between items-center gap-2 pt-1 flex-wrap">
                                        <span className="text-sm font-medium text-slate-600">Account Name</span>
                                        <span className="text-base font-black text-slate-900 break-all">{paymentInfo.accountName || "One Estela Place"}</span>
                                    </div>
                                </div>
                            </div>

                            <BankTransferQR />

                            <div className="space-y-3">
                                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-900">Upload Proof of Payment</Label>
                                <p className="text-sm text-slate-500">{paymentInfo.instructions || "Please upload a clear screenshot of your bank transfer receipt."}</p>
                                
                                {!proofFile ? (
                                    <div className="relative border-2 border-dashed border-slate-300 rounded-2xl p-6 sm:p-10 hover:bg-slate-50 hover:border-[#ea580c] transition-colors group text-center cursor-pointer mt-4">
                                        <input 
                                            type="file" 
                                            accept="image/*" 
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
                                            onChange={handleFileChange}
                                        />
                                        <UploadCloud className="w-12 h-12 text-slate-300 mx-auto mb-4 group-hover:text-[#ea580c] transition-colors" />
                                        <p className="text-base font-bold text-slate-900">Click to upload or drag and drop</p>
                                        <p className="text-xs text-slate-500 mt-2">PNG, JPG, or PDF (Max 5MB)</p>
                                    </div>
                                ) : (
                                    <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex items-center justify-between mt-4">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 shadow-sm">
                                                <FileImage className="w-6 h-6" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-black text-emerald-900 line-clamp-1">{proofFile.name}</p>
                                                <p className="text-xs text-emerald-600 font-medium">Ready for verification</p>
                                            </div>
                                        </div>
                                        <button onClick={() => setProofFile(null)} className="h-11 w-11 p-2 hover:bg-emerald-100 rounded-full text-emerald-600 transition-colors">
                                            <X className="w-5 h-5" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 flex items-start gap-4 animate-in fade-in slide-in-from-bottom-4">
                            <Info className="w-7 h-7 text-blue-500 shrink-0 mt-0.5" />
                            <div>
                                <h4 className="text-lg font-black text-blue-900 mb-1.5">Cash Payment Instructions</h4>
                                <p className="text-sm text-blue-800 leading-relaxed">
                                    Please visit the One Estela Place admin office to pay exactly <strong className="font-black text-lg">₱{amountToPay.toLocaleString()}</strong> within 24 hours. Your booking status will remain "Pending" until the cash is received and verified by our staff.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

            </div>

            {/* RIGHT COLUMN: BOOKING SUMMARY */}
            <div className="lg:col-span-1">
                <div className="bg-slate-900 rounded-[2rem] p-6 shadow-xl sticky top-6">
                    <h3 className="text-xl font-black text-white mb-6">Booking Summary</h3>
                    
                    <div className="space-y-4 mb-6">
                        <div className="bg-slate-800/50 p-5 rounded-2xl border border-slate-700/50">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-1.5">Event Name</p>
                            <p className="font-black text-white text-lg">{booking.eventName}</p>
                            <p className="text-xs text-slate-300 mt-1 flex items-center gap-1.5"><MapPin className="w-3 h-3"/> {booking.venue}</p>
                        </div>
                        <div className="bg-slate-800/50 p-5 rounded-2xl border border-slate-700/50">
                            <div className="flex justify-between items-center mb-3 pb-3 border-b border-slate-700/50">
                                <div className="flex items-center gap-2">
                                    <Calendar className="w-4 h-4 text-slate-400" />
                                    <span className="font-black text-white text-sm">{booking.date}</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Clock className="w-4 h-4 text-slate-400" />
                                <span className="font-black text-white text-sm">{booking.time || booking.startTime}</span>
                            </div>
                        </div>
                    </div>

                    <div className="bg-slate-800/80 p-5 rounded-2xl border border-slate-700/50 space-y-4 mb-8">
                        <div className="flex justify-between items-center">
                            <span className="text-slate-400 text-sm">Total Fee</span>
                            <span className="text-white font-bold">₱{totalPrice.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-slate-400 text-sm">Payment Type</span>
                            <span className="text-white font-bold">{paymentType === 'full' ? 'Full Payment' : 'Down Payment'}</span>
                        </div>
                        <div className="flex justify-between items-center pt-4 border-t border-slate-700 border-dashed">
                            <span className="text-slate-300 text-sm font-black uppercase tracking-[0.2em]">Amount to Pay</span>
                            <span className="text-3xl font-black text-[#ea580c]">₱{amountToPay.toLocaleString()}</span>
                        </div>
                    </div>

                    <Button 
                        onClick={handleSubmitPayment}
                        disabled={isSubmitting || (paymentMethod === "bank" && !proofFile)}
                        className="w-full h-14 rounded-full bg-[#ea580c] hover:bg-[#c2410c] text-white text-base font-black shadow-[0_0_20px_rgba(234,88,12,0.3)] flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:hover:bg-[#ea580c] hover:scale-[1.02] active:scale-95"
                    >
                        {isSubmitting ? (
                            "Processing Payment..."
                        ) : (
                            <>
                                <ShieldCheck className="w-5 h-5" /> 
                                Submit for Verification
                            </>
                        )}
                    </Button>
                    <p className="text-center text-[10px] text-slate-400 mt-4 font-medium px-4">By submitting, you agree to our terms including the non-refundable policy for down payments.</p>
                </div>
            </div>

        </div>
      </div>
    </div>
  )
}