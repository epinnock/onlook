-- Create the `expo-projects` storage bucket required by the ExpoBrowser
-- provider. The RLS policies in `20260407210000_expo_projects_storage_rls.sql`
-- assume this bucket exists; without it, `storage.upload` fails with
-- "Bucket not found" in local dev (production has it manually provisioned).
-- This migration restores parity so a fresh `supabase db:push` produces a
-- working local environment. Idempotent via `ON CONFLICT DO NOTHING`.
--
-- Non-public: all access gates through the per-user RLS policies that join
-- against `public.user_projects`. File size cap mirrors the ExpoBrowser
-- worker's practical upper bound.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('expo-projects', 'expo-projects', FALSE, 52428800)
ON CONFLICT (id) DO NOTHING;
