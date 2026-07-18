"use client"

import type React from "react"

import { useState } from "react"
import { MainLayout } from "@/components/main-layout"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/modules/shared/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/src/modules/shared/components/ui/dialog"
import { Input } from "@/src/modules/shared/components/ui/input"
import { Label } from "@/src/modules/shared/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/modules/shared/components/ui/select"
import { Textarea } from "@/src/modules/shared/components/ui/textarea"
import { useToast } from "@/src/modules/shared/hooks/use-toast"

// Mock data for reviews
const reviewsData = [
  {
    id: 1,
    name: "Sarah Johnson",
    event: "Wedding Reception",
    date: "May 10, 2025",
    rating: 5,
    comment:
      "One Estela Place was the perfect venue for our wedding. The staff was incredibly helpful and the venue itself is stunning. Highly recommend!",
  },
  {
    id: 2,
    name: "Michael Chen",
    event: "Corporate Event",
    date: "April 22, 2025",
    rating: 4,
    comment: "Great venue for our company retreat. The facilities were excellent and the staff was very accommodating.",
  },
  {
    id: 3,
    name: "Jessica Williams",
    event: "Birthday Party",
    date: "April 15, 2025",
    rating: 5,
    comment: "Had my 30th birthday here and it was amazing! The space is beautiful and everyone had a great time.",
  },
  {
    id: 4,
    name: "Robert Garcia",
    event: "Charity Gala",
    date: "March 28, 2025",
    rating: 4,
    comment: "Excellent venue for our annual charity event. Spacious and elegant with great amenities.",
  },
]

export default function ReviewsPage() {
  const [reviews, setReviews] = useState(reviewsData)
  const [selectedReview, setSelectedReview] = useState<any>(null)
  const { toast } = useToast()

  const handleAddReview = (e: React.FormEvent) => {
    e.preventDefault()
    toast({
      title: "Review added",
      description: "The new review has been successfully added",
    })
  }

  const handleFeatureReview = (id: number) => {
    toast({
      title: "Review featured",
      description: "The review has been featured on the website",
    })
  }

  const handleDeleteReview = (id: number) => {
    setReviews(reviews.filter((review) => review.id !== id))
    toast({
      title: "Review deleted",
      description: "The review has been successfully deleted",
      variant: "destructive",
    })
  }

  return (
    <MainLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-x-hidden space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h1 className="text-3xl font-bold">Customer Reviews</h1>
          <Dialog>
            <DialogTrigger asChild>
              <Button>Add Review</Button>
            </DialogTrigger>
            <DialogContent className="w-[95vw] sm:max-w-[425px] max-h-[90dvh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add New Review</DialogTitle>
                <DialogDescription>Add a customer review to your website.</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddReview}>
                <div className="space-y-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="customer-name" className="text-[10px] font-black uppercase tracking-[0.2em]">Customer Name</Label>
                    <Input id="customer-name" placeholder="Enter customer name" required className="w-full" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="event-type" className="text-[10px] font-black uppercase tracking-[0.2em]">Event Type</Label>
                    <Input id="event-type" placeholder="Enter event type" required className="w-full" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="event-date" className="text-[10px] font-black uppercase tracking-[0.2em]">Event Date</Label>
                    <Input id="event-date" type="date" required className="w-full" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="rating" className="text-[10px] font-black uppercase tracking-[0.2em]">Rating</Label>
                    <Select defaultValue="5">
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select rating" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 Star</SelectItem>
                        <SelectItem value="2">2 Stars</SelectItem>
                        <SelectItem value="3">3 Stars</SelectItem>
                        <SelectItem value="4">4 Stars</SelectItem>
                        <SelectItem value="5">5 Stars</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="review-text" className="text-[10px] font-black uppercase tracking-[0.2em]">Review</Label>
                    <Textarea id="review-text" placeholder="Enter customer review" required className="w-full" />
                  </div>
                </div>
                <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button type="submit" className="w-full sm:w-auto">Add Review</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid gap-6">
          {reviews.map((review) => (
            <Card key={review.id}>
              <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <CardTitle>{review.name}</CardTitle>
                    <CardDescription>
                      {review.event} - {review.date}
                    </CardDescription>
                  </div>
                  <div className="flex items-center">
                    {[...Array(5)].map((_, i) => (
                      <svg
                        key={i}
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill={i < review.rating ? "currentColor" : "none"}
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`h-5 w-5 ${i < review.rating ? "text-yellow-400" : "text-gray-300"}`}
                      >
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700">{review.comment}</p>
                <div className="mt-4 flex justify-end space-x-2">
                  <Button variant="outline" size="sm" onClick={() => handleFeatureReview(review.id)}>
                    Feature
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => handleDeleteReview(review.id)}>
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </MainLayout>
  )
}
