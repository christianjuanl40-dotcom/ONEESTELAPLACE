"use client"

import type React from "react"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/src/modules/shared/components/ui/dialog"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Input } from "@/src/modules/shared/components/ui/input"
import { Label } from "@/src/modules/shared/components/ui/label"
import { Textarea } from "@/src/modules/shared/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/modules/shared/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/modules/shared/components/ui/tabs"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import { HelpCircle, MessageSquare, Phone, Mail } from "lucide-react"

interface SupportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SupportDialog({ open, onOpenChange }: SupportDialogProps) {
  const { toast } = useToast()
  const [ticketData, setTicketData] = useState({
    subject: "",
    category: "",
    priority: "",
    message: "",
  })

  const handleTicketSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    toast({
      title: "Support ticket submitted",
      description: "We'll get back to you within 24 hours.",
    })
    setTicketData({ subject: "", category: "", priority: "", message: "" })
  }

  const faqs = [
    {
      question: "How do I modify my booking?",
      answer:
        "You can modify your booking by going to 'My Transactions' and clicking 'Modify Booking' on your reservation.",
    },
    {
      question: "What is your cancellation policy?",
      answer:
        "Cancellations made 90+ days before receive full refund. 30-89 days receive 50% refund. Within 30 days are non-refundable.",
    },
    {
      question: "How do I download my receipt?",
      answer: "Go to 'My Transactions' and click 'Download Receipt' next to your booking.",
    },
    {
      question: "Can I change my event date?",
      answer: "Yes, subject to availability. Contact us or submit a support ticket to request a date change.",
    },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-2xl overflow-y-auto max-h-[90dvh] rounded-2xl">
        <DialogHeader>
          <DialogTitle>Support / Help Center</DialogTitle>
          <DialogDescription>Get help with your bookings and account</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="faq" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="faq">FAQs</TabsTrigger>
            <TabsTrigger value="contact">Contact</TabsTrigger>
            <TabsTrigger value="ticket">Support Ticket</TabsTrigger>
          </TabsList>
          <TabsContent value="faq" className="space-y-4">
            <div className="space-y-4">
              <h3 className="font-semibold flex items-center">
                <HelpCircle className="mr-2 h-5 w-5" />
                Frequently Asked Questions
              </h3>
              {faqs.map((faq, index) => (
                <div key={index} className="border rounded-lg p-4">
                  <h4 className="font-medium mb-2">{faq.question}</h4>
                  <p className="text-sm text-gray-600">{faq.answer}</p>
                </div>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="contact" className="space-y-4">
            <div className="space-y-4">
              <h3 className="font-semibold">Contact Information</h3>
              <div className="grid gap-4">
                <div className="flex items-center space-x-3 p-3 border rounded-lg">
                  <Phone className="h-5 w-5 text-blue-600" />
                  <div>
                    <p className="font-medium">Phone</p>
                    <p className="text-sm text-gray-600">(555) 123-4567</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3 p-3 border rounded-lg">
                  <Mail className="h-5 w-5 text-blue-600" />
                  <div>
                    <p className="font-medium">Email</p>
                    <p className="text-sm text-gray-600">support@oneestela.com</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3 p-3 border rounded-lg">
                  <MessageSquare className="h-5 w-5 text-blue-600" />
                  <div>
                    <p className="font-medium">Live Chat</p>
                    <p className="text-sm text-gray-600">Available Mon-Fri 9AM-6PM</p>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="ticket" className="space-y-4">
            <form onSubmit={handleTicketSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="subject" className="text-[10px] font-black uppercase tracking-[0.2em]">Subject</Label>
                <Input
                  id="subject"
                  placeholder="Brief description of your issue"
                  value={ticketData.subject}
                  onChange={(e) => setTicketData({ ...ticketData, subject: e.target.value })}
                  required
                  className="h-11 w-full"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="category" className="text-[10px] font-black uppercase tracking-[0.2em]">Category</Label>
                  <Select
                    value={ticketData.category}
                    onValueChange={(value) => setTicketData({ ...ticketData, category: value })}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="booking">Booking Issue</SelectItem>
                      <SelectItem value="payment">Payment Problem</SelectItem>
                      <SelectItem value="account">Account Issue</SelectItem>
                      <SelectItem value="technical">Technical Problem</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="priority" className="text-[10px] font-black uppercase tracking-[0.2em]">Priority</Label>
                  <Select
                    value={ticketData.priority}
                    onValueChange={(value) => setTicketData({ ...ticketData, priority: value })}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Select priority" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="message" className="text-[10px] font-black uppercase tracking-[0.2em]">Message</Label>
                <Textarea
                  id="message"
                  placeholder="Describe your issue in detail..."
                  rows={4}
                  value={ticketData.message}
                  onChange={(e) => setTicketData({ ...ticketData, message: e.target.value })}
                  required
                />
              </div>
              <Button type="submit" className="w-full h-11">
                Submit Support Ticket
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
