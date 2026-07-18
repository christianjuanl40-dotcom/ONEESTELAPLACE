// LocalStorage-backed stub for the original Supabase chat client.
// The project is frontend-only with LocalStorage, so the Supabase calls
// have been replaced with no-op functions that return empty data.

export interface ChatConversation {
  id: string
  customer_id: string
  customer_name: string
  customer_email: string
  admin_id?: string
  last_message?: string
  last_message_time?: string
  created_at: string
  updated_at: string
  unread_count: number
  is_active: boolean
}

export interface ChatMessage {
  id: string
  conversation_id: string
  sender_id: string
  sender_type: "admin" | "customer"
  sender_name: string
  content: string
  created_at: string
  read_at?: string
}

export interface TypingIndicator {
  id: string
  conversation_id: string
  user_id: string
  user_name: string
  typing: boolean
  updated_at: string
}

export async function getConversations(): Promise<ChatConversation[]> {
  return []
}

export async function getConversationById(conversationId: string): Promise<ChatConversation | null> {
  return null
}

export async function createConversation(
  customerId: string,
  customerName: string,
  customerEmail: string
): Promise<ChatConversation | null> {
  return null
}

export async function getMessages(conversationId: string): Promise<ChatMessage[]> {
  return []
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  senderType: "admin" | "customer",
  senderName: string,
  content: string
): Promise<ChatMessage | null> {
  return null
}

export async function markMessageAsRead(messageId: string): Promise<void> {
  return
}

export async function setTypingStatus(
  conversationId: string,
  userId: string,
  userName: string,
  typing: boolean
): Promise<void> {
  return
}

export function subscribeToMessages(
  conversationId: string,
  callback: (message: ChatMessage) => void
): () => void {
  return () => {}
}

export function subscribeToConversations(callback: (conversation: ChatConversation) => void): () => void {
  return () => {}
}

export function subscribeToTypingIndicators(
  conversationId: string,
  callback: (typingUsers: string[]) => void
): () => void {
  return () => {}
}
