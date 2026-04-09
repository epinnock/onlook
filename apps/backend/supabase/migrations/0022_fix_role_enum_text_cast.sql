-- 0022_fix_role_enum_text_cast.sql
--
-- Fix the original 0006_rls.sql definition of user_has_project_access and
-- user_has_canvas_access. Both functions accept `required_roles text[]` but
-- compare it directly against `user_projects.role`, which is a `project_role`
-- enum. Postgres has no implicit text↔enum cast, so the comparison fails at
-- runtime with:
--
--     ERROR: operator does not exist: project_role = text
--
-- The error surfaces from anywhere that touches a row those policies guard:
-- the editor's preload-script upload to storage triggers the
-- expo_projects_insert_owner policy → user_projects subquery → user_projects
-- SELECT policy → user_has_project_access(...) → boom.
--
-- The fix is one cast on the LEFT side of `= ANY(...)` so the comparison
-- happens in text space. Callers (RLS policies) keep passing text[].
--
-- Discovered while wiring the Phase Q "Preview on device" flow against the
-- seeded ExpoBrowser test branch (project 2bff33ae-...). Without this patch,
-- SandboxManager.initializeSyncEngine throws on first load and the editor
-- crashes with a client-side exception. After the patch, storage upserts
-- (insert + on-conflict-update) work as expected.

CREATE OR REPLACE FUNCTION public.user_has_project_access(
    project_id_param uuid,
    required_roles text[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_projects
        WHERE user_projects.project_id = project_id_param
        AND user_projects.user_id = auth.uid()
        AND user_projects.role::text = ANY(required_roles)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.user_has_canvas_access(
    canvas_id_param uuid,
    required_roles text[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM canvas c
        JOIN user_projects up ON c.project_id = up.project_id
        WHERE c.id = canvas_id_param
        AND up.user_id = auth.uid()
        AND up.role::text = ANY(required_roles)
    );
END;
$function$;
