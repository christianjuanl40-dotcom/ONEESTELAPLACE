-- Create customer chat conversations table
CREATE TABLE IF NOT EXISTS customer_chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_avatar TEXT,
  last_message TEXT,
  last_message_time TIMESTAMP WITH TIME ZONE,
  unread_count INT DEFAULT 0,
  is_online BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create customer chat messages table
CREATE TABLE IF NOT EXISTS customer_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES customer_chat_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  sender_type VARCHAR(50) NOT NULL,
  sender_name TEXT NOT NULL,
  sender_avatar TEXT,
  content TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create typing indicators table
CREATE TABLE IF NOT EXISTS customer_typing_indicators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES customer_chat_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  is_typing BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '3 seconds'
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_conversations_admin_id ON customer_chat_conversations(admin_id);
CREATE INDEX IF NOT EXISTS idx_conversations_customer_id ON customer_chat_conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON customer_chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON customer_chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_typing_conversation_id ON customer_typing_indicators(conversation_id);

-- Enable Row Level Security
ALTER TABLE customer_chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_typing_indicators ENABLE ROW LEVEL SECURITY;

-- RLS Policies for conversations
CREATE POLICY "Users can view their own conversations" ON customer_chat_conversations
  FOR SELECT USING (auth.uid()::text = admin_id::text OR auth.uid()::text = customer_id::text);

CREATE POLICY "Users can update their own conversations" ON customer_chat_conversations
  FOR UPDATE USING (auth.uid()::text = admin_id::text OR auth.uid()::text = customer_id::text);

-- RLS Policies for messages
CREATE POLICY "Users can view messages in their conversations" ON customer_chat_messages
  FOR SELECT USING (
    conversation_id IN (
      SELECT id FROM customer_chat_conversations 
      WHERE auth.uid()::text = admin_id::text OR auth.uid()::text = customer_id::text
    )
  );

CREATE POLICY "Users can insert messages in their conversations" ON customer_chat_messages
  FOR INSERT WITH CHECK (
    conversation_id IN (
      SELECT id FROM customer_chat_conversations 
      WHERE auth.uid()::text = admin_id::text OR auth.uid()::text = customer_id::text
    )
  );
