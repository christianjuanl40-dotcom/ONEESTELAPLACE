// Local stub for chat-socket. The Message type is intentionally permissive
// because the chat context uses runtime-inferred shapes.

export interface Message {
  id: string
  text: string
  sender: "user" | "admin" | "bot"
  senderId?: string
  senderName?: string
  targetId?: string
  timestamp: number | string | Date
  imageUrl?: string | null
  isRead?: boolean
  isReadByClient?: boolean
}

let channel: BroadcastChannel | null = null;

export function connectToChatSocket(onMessageReceived: (msg: Message) => void) {
  if (typeof window === "undefined") return null;

  if (!channel) {
    try {
      channel = new BroadcastChannel("capstone_live_chat");
    } catch {
      return null;
    }
  }

  channel.onmessage = (event) => {
    onMessageReceived(event.data as Message);
  };

  return channel;
}

export function sendSocketMessage(message: Message) {
  if (typeof window === "undefined") return;

  if (!channel) {
    try {
      channel = new BroadcastChannel("capstone_live_chat");
    } catch {
      return;
    }
  }

  channel.postMessage(message);
}
