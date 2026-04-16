import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { EXPO_BROWSER_TEST_BRANCH } from '../../fixtures/test-branch';

const LOCAL_DB_CONTAINER = 'supabase_db_onlook-web';
const DEMO_USER_ID = '2585ea6b-6303-4f21-977c-62af2f5a21f4';
const DEMO_USER_EMAIL = 'support@onlook.com';

function resolveRepoRoot(): string {
    const cwd = process.cwd();
    const rootFromCwd = path.join(
        cwd,
        'apps/web/client/verification/onlook-editor/setup.sh',
    );

    if (existsSync(rootFromCwd)) {
        return cwd;
    }

    const rootFromApp = path.resolve(cwd, '../../..');
    if (
        existsSync(
            path.join(
                rootFromApp,
                'apps/web/client/verification/onlook-editor/setup.sh',
            ),
        )
    ) {
        return rootFromApp;
    }

    throw new Error(`Unable to resolve repo root from cwd: ${cwd}`);
}

function runVerificationSetup(repoRoot: string): void {
    const setupScriptPath = path.join(
        repoRoot,
        'apps/web/client/verification/onlook-editor/setup.sh',
    );

    execFileSync('bash', [setupScriptPath], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 300_000,
    });
}

function seedExpoBrowserProjectBranch(): void {
    const { projectId, branchId } = EXPO_BROWSER_TEST_BRANCH;
    const sql = `
DO $$
DECLARE
    v_project_id uuid := '${projectId}';
    v_branch_id uuid := '${branchId}';
    v_canvas_id uuid;
    v_user_id uuid := '${DEMO_USER_ID}';
BEGIN
    INSERT INTO projects (id, name, description, sandbox_id, sandbox_url, created_at, updated_at)
    VALUES (
        v_project_id,
        'ExpoBrowser E2E Fixture',
        'Auto-created for apps/web/client/e2e/expo-browser specs',
        'expo-browser-test-sandbox',
        '/preview/expo-browser-test',
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO user_projects (user_id, project_id, role)
    VALUES (v_user_id, v_project_id, 'owner')
    ON CONFLICT (user_id, project_id) DO UPDATE SET role = 'owner';

    SELECT id INTO v_canvas_id FROM canvas WHERE project_id = v_project_id LIMIT 1;
    IF v_canvas_id IS NULL THEN
        v_canvas_id := gen_random_uuid();
        INSERT INTO canvas (id, project_id) VALUES (v_canvas_id, v_project_id);
    END IF;

    INSERT INTO user_canvases (user_id, canvas_id, scale, x, y)
    VALUES (v_user_id, v_canvas_id, 1, 0, 0)
    ON CONFLICT (user_id, canvas_id) DO NOTHING;

    INSERT INTO branches (id, project_id, name, description, sandbox_id, provider_type, is_default, created_at, updated_at)
    VALUES (
        v_branch_id,
        v_project_id,
        'main',
        'ExpoBrowser E2E branch',
        'expo-browser-test-sandbox',
        'expo_browser',
        true,
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET provider_type = 'expo_browser';

    UPDATE users
    SET feature_flags = jsonb_set(
        COALESCE(feature_flags, '{}'::jsonb),
        '{useExpoBrowserPreview}',
        'true'::jsonb,
        true
    )
    WHERE id = v_user_id;

    IF NOT EXISTS (SELECT 1 FROM frames WHERE branch_id = v_branch_id) THEN
        INSERT INTO frames (id, canvas_id, branch_id, x, y, width, height, url, type)
        VALUES (
            gen_random_uuid(),
            v_canvas_id,
            v_branch_id,
            0,
            0,
            1024,
            768,
            'http://127.0.0.1:3001/preview/' || v_branch_id || '/main/',
            'web'
        );
    END IF;
END $$;
`;

    execFileSync(
        'docker',
        ['exec', '-i', LOCAL_DB_CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
        {
            encoding: 'utf8',
            input: sql,
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 120_000,
        },
    );
}

function seedExpoBrowserFixtureFiles(repoRoot: string): void {
    const { projectId, branchId } = EXPO_BROWSER_TEST_BRANCH;

    execFileSync(
        'bun',
        [
            'run',
            path.join(repoRoot, 'scripts/seed-expo-fixture.ts'),
            '--project-id',
            projectId,
            '--branch-id',
            branchId,
        ],
        {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: 'pipe',
            timeout: 300_000,
        },
    );
}

export function seedExpoBrowserTestBranch(): void {
    const repoRoot = resolveRepoRoot();

    runVerificationSetup(repoRoot);
    seedExpoBrowserProjectBranch();
    seedExpoBrowserFixtureFiles(repoRoot);
}

export const EXPO_BROWSER_DEMO_USER_EMAIL = DEMO_USER_EMAIL;
