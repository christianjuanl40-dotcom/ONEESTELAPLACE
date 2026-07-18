"use client"

import type React from "react"

import { useState } from "react"
import { PublicLayout } from "@/components/public-layout"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/modules/shared/components/ui/card"
import { Input } from "@/src/modules/shared/components/ui/input"
import { Label } from "@/src/modules/shared/components/ui/label"
import { Textarea } from "@/src/modules/shared/components/ui/textarea"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import { MapPin, Phone, Mail, Clock } from "lucide-react"
import { TermsDialog } from "@/components/terms-dialog"
import { useMessages } from "@/components/message-context"

export default function ContactPage() {
  const { toast } = useToast()
  const { addMessage } = useMessages()
  const [showTerms, setShowTerms] = useState(false)
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    eventType: "",
    eventDate: "",
    message: "",
  })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!agreedToTerms) {
      toast({
        title: "Terms agreement required",
        description: "Please read and agree to the terms and conditions.",
        variant: "destructive",
      })
      return
    }

    // Add message to the system
    addMessage({
      name: formData.name,
      email: formData.email,
      phone: formData.phone,
      eventType: formData.eventType,
      eventDate: formData.eventDate,
      message: formData.message,
    })

    toast({
      title: "Message sent!",
      description: "Thank you for your inquiry. We'll get back to you within 24 hours.",
    })

    // Reset form
    setFormData({
      name: "",
      email: "",
      phone: "",
      eventType: "",
      eventDate: "",
      message: "",
    })
    setAgreedToTerms(false)
  }

  return (
    <PublicLayout>
      <div className="max-w-7xl mx-auto container px-4 sm:px-6 lg:px-8 py-12 overflow-x-hidden">
        <div className="mb-12 text-center">
          <h1 className="mb-6 text-4xl font-bold text-gray-900">Contact Us</h1>
          <p className="text-lg text-gray-600">Ready to plan your event? Get in touch with our team today.</p>
        </div>

        <div className="grid gap-12 lg:grid-cols-2">
          {/* Contact Form */}
          <Card className="border-slate-200 shadow-lg">
            <CardHeader>
              <CardTitle className="text-gray-900">Send us a message</CardTitle>
              <CardDescription className="text-gray-600">
                Fill out the form below and we'll get back to you as soon as possible.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-700">
                      Full Name
                    </Label>
                    <Input
                      id="name"
                      name="name"
                      placeholder="Your name"
                      value={formData.name}
                      onChange={handleInputChange}
                      required
                      className="h-11 w-full border-gray-300 focus:border-orange-500 focus:ring-orange-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-700">
                      Email
                    </Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="your@email.com"
                      value={formData.email}
                      onChange={handleInputChange}
                      required
                      className="h-11 w-full border-gray-300 focus:border-orange-500 focus:ring-orange-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone" className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-700">
                      Phone
                    </Label>
                    <Input
                      id="phone"
                      name="phone"
                      type="tel"
                      placeholder="(555) 123-4567"
                      value={formData.phone}
                      onChange={handleInputChange}
                      className="h-11 w-full border-gray-300 focus:border-orange-500 focus:ring-orange-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="eventType" className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-700">
                      Event Type
                    </Label>
                    <Input
                      id="eventType"
                      name="eventType"
                      placeholder="Wedding, Corporate, etc."
                      value={formData.eventType}
                      onChange={handleInputChange}
                      className="h-11 w-full border-gray-300 focus:border-orange-500 focus:ring-orange-500"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="eventDate" className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-700">
                    Preferred Event Date
                  </Label>
                  <Input
                    id="eventDate"
                    name="eventDate"
                    type="date"
                    value={formData.eventDate}
                    onChange={handleInputChange}
                    className="h-11 w-full border-gray-300 focus:border-orange-500 focus:ring-orange-500"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="message" className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-700">
                    Message
                  </Label>
                  <Textarea
                    id="message"
                    name="message"
                    placeholder="Tell us about your event..."
                    rows={4}
                    value={formData.message}
                    onChange={handleInputChange}
                    required
                    className="h-11 min-h-[100px] w-full border-gray-300 focus:border-orange-500 focus:ring-orange-500"
                  />
                </div>
                <div className="flex items-start space-x-2">
                  <input
                    type="checkbox"
                    id="contact-terms"
                    checked={agreedToTerms}
                    onChange={(e) => setAgreedToTerms(e.target.checked)}
                    className="mt-1 accent-orange-500"
                  />
                  <label htmlFor="contact-terms" className="text-sm text-gray-600">
                    I agree to the{" "}
                    <button
                      type="button"
                      onClick={() => setShowTerms(true)}
                      className="text-orange-500 hover:text-orange-600 hover:underline font-medium"
                    >
                      Terms and Conditions
                    </button>{" "}
                    and understand the booking policies.
                  </label>
                </div>
                <Button
                  type="submit"
                  className="w-full sm:w-auto h-11 bg-orange-500 text-white hover:bg-orange-600 shadow-lg border-0"
                >
                  Send Message
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Contact Information */}
          <div className="space-y-8">
            <Card className="border-slate-200 shadow-lg hover:shadow-xl transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center text-gray-900">
                  <MapPin className="mr-2 h-5 w-5 text-orange-500" />
                  Location
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">
                  123 Event Street
                  <br />
                  Downtown District
                  <br />
                  City, State 12345
                </p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-lg hover:shadow-xl transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center text-gray-900">
                  <Phone className="mr-2 h-5 w-5 text-orange-500" />
                  Phone
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">(555) 123-4567</p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-lg hover:shadow-xl transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center text-gray-900">
                  <Mail className="mr-2 h-5 w-5 text-orange-500" />
                  Email
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">info@oneestela.com</p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-lg hover:shadow-xl transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center text-gray-900">
                  <Clock className="mr-2 h-5 w-5 text-orange-500" />
                  Business Hours
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 text-gray-600">
                  <p>Monday - Friday: 9:00 AM - 6:00 PM</p>
                  <p>Saturday: 10:00 AM - 4:00 PM</p>
                  <p>Sunday: By appointment only</p>
                </div>
              </CardContent>
            </Card>

            {/* Interactive Google Map */}
            <Card className="border-slate-200 shadow-lg hover:shadow-xl transition-shadow">
              <CardHeader>
                <CardTitle className="text-gray-900">Find Us</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64 rounded-lg overflow-hidden border border-orange-200">
                  <iframe
                    src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3861.2089!2d121.0244!3d14.5547!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zMTTCsDMzJzE3LjAiTiAxMjHCsDAyJzE2LjAiRQ!5e0!3m2!1sen!2sph!4v1234567890"
                    width="100%"
                    height="100%"
                    style={{ border: 0 }}
                    allowFullScreen
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    title="One Estela Place Location"
                  />
                </div>
                <div className="mt-4 text-center">
                  <a
                    href="https://maps.app.goo.gl/U56VTkSLYGXwtawA8"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-orange-500 hover:text-orange-600 font-medium hover:underline"
                  >
                    <MapPin className="mr-1 h-4 w-4" />
                    Open in Google Maps
                  </a>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <TermsDialog open={showTerms} onOpenChange={setShowTerms} />
    </PublicLayout>
  )
}
