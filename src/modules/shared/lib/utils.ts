import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ==========================================
// UNIFIED STATUS & BOOKING RULES (PHASE 1)
// ==========================================

// Unified Status System
export type BookingStatus = 'PENDING' | 'PAYMENT_UPLOADED' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'DECLINED';

// Flexible Cancellation Rule Configuration 
export const CANCELLATION_THRESHOLD_DAYS = 14; // 2 weeks before the event

// Helper function: Calculate days before event
export function getDaysBeforeEvent(eventDate: string | Date): number {
  if (!eventDate) return 0;
  
  const event = new Date(eventDate);
  const today = new Date();
  
  // Set time to midnight para accurate ang day calculation (ignore time)
  event.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  
  const diffTime = event.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// Helper function: Check if cancellation is still valid
export function isCancellationAllowed(eventDate: string | Date): boolean {
  if (!eventDate) return false;
  const daysBefore = getDaysBeforeEvent(eventDate);
  return daysBefore >= CANCELLATION_THRESHOLD_DAYS;
}