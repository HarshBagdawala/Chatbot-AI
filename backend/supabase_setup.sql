CREATE TABLE IF NOT EXISTS chat_messages (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id  TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Indexing for fast session lookup
CREATE INDEX IF NOT EXISTS idx_chat_session_id ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_created_at ON chat_messages(created_at);

-- Row Level Security (RLS) enable karo
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Policy: Anon users apna session read/write kar sakte hain
CREATE POLICY "allow_anon_insert" ON chat_messages
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "allow_anon_select" ON chat_messages
  FOR SELECT TO anon USING (true);

CREATE POLICY "allow_anon_delete" ON chat_messages
  FOR DELETE TO anon USING (true);

-- Verify table created
SELECT 'chat_messages table ready! ✅' AS status;
