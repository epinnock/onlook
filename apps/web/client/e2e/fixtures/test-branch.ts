/**
 * Shared test-branch fixture for ExpoBrowser end-to-end specs.
 *
 * The IDs below match the Sprint 0 / Wave A integration fixtures used by
 * `packages/code-provider/src/providers/expo-browser/__tests__/integration.test.ts`.
 *
 * For the specs that import this fixture to actually pass, a row must exist
 * in the local Postgres `branches` table with:
 *   id            = '00000000-0000-0000-0000-000000000abc'
 *   project_id    = '00000000-0000-0000-0000-000000000001'
 *   provider_type = 'expo_browser'
 *
 * Until that row exists (and the matching user feature flag is enabled), the
 * specs will fail at navigation — that is the intentional red gate for
 * TE.0 / TE.1 / TE.3 in `plans/expo-browser-task-queue.md`.
 */

export interface TestBranch {
    projectId: string;
    branchId: string;
}

export const EXPO_BROWSER_TEST_BRANCH: TestBranch = {
    projectId: '00000000-0000-0000-0000-000000000001',
    branchId: '00000000-0000-0000-0000-000000000abc',
};
