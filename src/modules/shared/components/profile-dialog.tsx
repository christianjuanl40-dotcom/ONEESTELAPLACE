"use client"

import type React from "react"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/src/modules/shared/components/ui/dialog"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Input } from "@/src/modules/shared/components/ui/input"
import { Label } from "@/src/modules/shared/components/ui/label"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import { useAuth } from "@/src/modules/shared/auth/auth-context"

interface ProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProfileDialog({ open, onOpenChange }: ProfileDialogProps) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [formData, setFormData] = useState({
    name: user?.name || "",
    email: user?.email || "",
    phone: user?.phone || "",
    address: "123 Main Street, City, State 12345",
    emergencyContact: "(555) 987-6543",
  })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    })
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    toast({
      title: "Profile updated",
      description: "Your profile information has been successfully updated.",
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-md overflow-y-auto max-h-[90dvh] rounded-2xl">
        <DialogHeader>
          <DialogTitle>My Profile</DialogTitle>
          <DialogDescription>View and edit your personal information</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-[10px] font-black uppercase tracking-[0.2em]">Full Name</Label>
            <Input id="name" name="name" value={formData.name} onChange={handleInputChange} required className="h-11 w-full" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-[0.2em]">Email</Label>
            <Input id="email" name="email" type="email" value={formData.email} onChange={handleInputChange} required className="h-11 w-full" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone" className="text-[10px] font-black uppercase tracking-[0.2em]">Phone Number</Label>
            <Input id="phone" name="phone" type="tel" value={formData.phone} onChange={handleInputChange} required className="h-11 w-full" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="address" className="text-[10px] font-black uppercase tracking-[0.2em]">Address</Label>
            <Input id="address" name="address" value={formData.address} onChange={handleInputChange} className="h-11 w-full" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="emergencyContact" className="text-[10px] font-black uppercase tracking-[0.2em]">Emergency Contact</Label>
            <Input
              id="emergencyContact"
              name="emergencyContact"
              value={formData.emergencyContact}
              onChange={handleInputChange}
              className="h-11 w-full"
            />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="h-11 w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" className="h-11 w-full sm:w-auto">Save Changes</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
