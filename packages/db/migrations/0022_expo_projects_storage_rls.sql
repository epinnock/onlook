-- TR1.3: Row Level Security policies for the `expo-projects` storage bucket.
--
-- Object keys in this bucket follow the layout `<projectId>/<branchId>/<filePath>`,
-- so `(storage.foldername(name))[1]` returns the project id. A user may read or
-- mutate an object only when a `user_projects` row links their `auth.uid()` to
-- that project id. The bucket itself is created separately (see storage seed);
-- this migration only installs the policies and is idempotent via DROP IF EXISTS.

DROP POLICY IF EXISTS "expo_projects_insert_owner" ON storage.objects;
CREATE POLICY "expo_projects_insert_owner"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'expo-projects'
    AND (storage.foldername(name))[1]::uuid IN (
        SELECT project_id FROM public.user_projects WHERE user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "expo_projects_select_owner" ON storage.objects;
CREATE POLICY "expo_projects_select_owner"
ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'expo-projects'
    AND (storage.foldername(name))[1]::uuid IN (
        SELECT project_id FROM public.user_projects WHERE user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "expo_projects_update_owner" ON storage.objects;
CREATE POLICY "expo_projects_update_owner"
ON storage.objects FOR UPDATE TO authenticated
USING (
    bucket_id = 'expo-projects'
    AND (storage.foldername(name))[1]::uuid IN (
        SELECT project_id FROM public.user_projects WHERE user_id = auth.uid()
    )
)
WITH CHECK (
    bucket_id = 'expo-projects'
    AND (storage.foldername(name))[1]::uuid IN (
        SELECT project_id FROM public.user_projects WHERE user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "expo_projects_delete_owner" ON storage.objects;
CREATE POLICY "expo_projects_delete_owner"
ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'expo-projects'
    AND (storage.foldername(name))[1]::uuid IN (
        SELECT project_id FROM public.user_projects WHERE user_id = auth.uid()
    )
);
