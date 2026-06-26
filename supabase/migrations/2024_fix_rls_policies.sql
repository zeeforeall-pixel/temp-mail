-- Migration: Fix RLS policies to prevent anon users from setting VIP fields
-- Run this in Supabase SQL Editor

-- =============================================
-- 1. temp_inboxes: Block anon from setting is_vip or password_plain
-- =============================================

-- Drop existing INSERT policy if it allows setting is_vip
DROP POLICY IF EXISTS "anon_can_insert_inboxes" ON temp_inboxes;
DROP POLICY IF EXISTS "enable_insert" ON temp_inboxes;
DROP POLICY IF EXISTS "Allow anon insert" ON temp_inboxes;
DROP POLICY IF EXISTS "temp_inboxes_insert" ON temp_inboxes;

-- Create restrictive INSERT policy:
-- Anon users can insert inboxes BUT cannot set is_vip=true or password_plain
-- (VIP creation goes through Edge Function with service_role key)
CREATE POLICY "anon_insert_no_vip"
ON temp_inboxes
FOR INSERT
TO anon
WITH CHECK (
  address IS NOT NULL
  AND domain IS NOT NULL
  AND owner_token IS NOT NULL
  AND owner_token != ''
  AND (is_vip IS NULL OR is_vip = false)
  AND password_plain IS NULL
);

-- =============================================
-- 2. temp_inboxes: SELECT policy (public read for disposable inboxes)
-- =============================================
DROP POLICY IF EXISTS "anon_can_select_own_inboxes" ON temp_inboxes;
DROP POLICY IF EXISTS "enable_select" ON temp_inboxes;
DROP POLICY IF EXISTS "Allow anon select" ON temp_inboxes;
DROP POLICY IF EXISTS "temp_inboxes_select" ON temp_inboxes;

CREATE POLICY "anon_select_own"
ON temp_inboxes
FOR SELECT
TO anon
USING (true);

-- =============================================
-- 3. temp_messages: SELECT policy
-- =============================================
DROP POLICY IF EXISTS "anon_can_select_messages" ON temp_messages;
DROP POLICY IF EXISTS "enable_select" ON temp_messages;
DROP POLICY IF EXISTS "Allow anon select" ON temp_messages;
DROP POLICY IF EXISTS "temp_messages_select" ON temp_messages;

CREATE POLICY "anon_select_messages"
ON temp_messages
FOR SELECT
TO anon
USING (true);

-- =============================================
-- 4. temp_domains: SELECT policy (public read)
-- =============================================
DROP POLICY IF EXISTS "anon_can_select_domains" ON temp_domains;
DROP POLICY IF EXISTS "enable_select" ON temp_domains;
DROP POLICY IF EXISTS "Allow anon select" ON temp_domains;
DROP POLICY IF EXISTS "temp_domains_select" ON temp_domains;

CREATE POLICY "anon_select_domains"
ON temp_domains
FOR SELECT
TO anon
USING (true);

-- =============================================
-- 5. Ensure RLS is enabled on all tables
-- =============================================
ALTER TABLE temp_inboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE temp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE temp_domains ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 6. CHECK constraint: password only when VIP
-- =============================================
ALTER TABLE temp_inboxes DROP CONSTRAINT IF EXISTS chk_vip_password;
ALTER TABLE temp_inboxes ADD CONSTRAINT chk_vip_password
  CHECK (password_plain IS NULL OR is_vip = true);
