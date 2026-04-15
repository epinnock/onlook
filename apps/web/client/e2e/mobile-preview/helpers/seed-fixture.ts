import {
    MOBILE_PREVIEW_E2E_FIXTURE,
    type MobilePreviewFixture,
    normalizeMobilePreviewFixturePath,
} from './fixture';

export interface MobilePreviewFixtureSeedTarget {
    writeFile(path: string, content: string): Promise<void>;
    readFile?(path: string): Promise<string | Uint8Array>;
    mkdir?(path: string): Promise<void>;
    listFiles?(
        path?: string,
    ): Promise<Array<{ path: string; type: 'file' | 'directory' }>>;
}

export interface SeedMobilePreviewFixtureOptions {
    basePath?: string;
    fixture?: MobilePreviewFixture;
}

export interface SeedMobilePreviewFixtureResult {
    fixture: MobilePreviewFixture;
    createdPaths: string[];
    updatedPaths: string[];
    unchangedPaths: string[];
    writtenPaths: string[];
}

function joinSeedPath(basePath: string | undefined, path: string): string {
    const normalizedBasePath = basePath
        ? normalizeMobilePreviewFixturePath(basePath)
        : '';
    const normalizedPath = normalizeMobilePreviewFixturePath(path);

    if (!normalizedBasePath) {
        return normalizedPath;
    }

    return `${normalizedBasePath}/${normalizedPath}`;
}

function listParentDirectories(path: string): string[] {
    const normalizedPath = normalizeMobilePreviewFixturePath(path);
    const segments = normalizedPath.split('/').filter(Boolean);
    const directories: string[] = [];

    for (let i = 1; i < segments.length; i++) {
        directories.push(segments.slice(0, i).join('/'));
    }

    return directories;
}

async function readFileIfPresent(
    target: MobilePreviewFixtureSeedTarget,
    path: string,
): Promise<string | null> {
    if (!target.readFile) {
        return null;
    }

    try {
        const current = await target.readFile(path);
        if (typeof current === 'string') {
            return current;
        }
        return new TextDecoder().decode(current);
    } catch {
        return null;
    }
}

async function listExistingPaths(
    target: MobilePreviewFixtureSeedTarget,
    basePath: string | undefined,
): Promise<Set<string> | null> {
    if (!target.listFiles) {
        return null;
    }

    try {
        const entries = await target.listFiles(basePath);
        return new Set(
            entries
                .filter((entry) => entry.type === 'file')
                .map((entry) => normalizeMobilePreviewFixturePath(entry.path)),
        );
    } catch {
        return null;
    }
}

export async function seedMobilePreviewFixture(
    target: MobilePreviewFixtureSeedTarget,
    options: SeedMobilePreviewFixtureOptions = {},
): Promise<SeedMobilePreviewFixtureResult> {
    const fixture = options.fixture ?? MOBILE_PREVIEW_E2E_FIXTURE;
    const createdPaths: string[] = [];
    const updatedPaths: string[] = [];
    const unchangedPaths: string[] = [];
    const writtenPaths: string[] = [];
    const ensuredDirectories = new Set<string>();
    const existingPaths = await listExistingPaths(target, options.basePath);

    for (const file of fixture.files) {
        const targetPath = joinSeedPath(options.basePath, file.path);

        if (target.mkdir) {
            for (const directory of listParentDirectories(targetPath)) {
                if (ensuredDirectories.has(directory)) {
                    continue;
                }
                await target.mkdir(directory);
                ensuredDirectories.add(directory);
            }
        }

        const current = await readFileIfPresent(target, targetPath);
        if (current === file.content) {
            unchangedPaths.push(targetPath);
            continue;
        }

        await target.writeFile(targetPath, file.content);
        writtenPaths.push(targetPath);

        const normalizedTargetPath = normalizeMobilePreviewFixturePath(targetPath);
        const wasPresent = current != null || existingPaths?.has(normalizedTargetPath);

        if (wasPresent) {
            updatedPaths.push(targetPath);
        } else {
            createdPaths.push(targetPath);
        }
    }

    return {
        fixture,
        createdPaths,
        updatedPaths,
        unchangedPaths,
        writtenPaths,
    };
}

const bunTestRuntime = (
    globalThis as typeof globalThis & {
        Bun?: { env?: Record<string, string | undefined> };
    }
).Bun;

if (bunTestRuntime && process.env.NODE_ENV === 'test') {
    const { describe, expect, test } = await import('bun:test');

    function createMemoryTarget(initialFiles?: Record<string, string>) {
        const files = new Map(
            Object.entries(initialFiles ?? {}).map(([path, content]) => [
                normalizeMobilePreviewFixturePath(path),
                content,
            ]),
        );
        const mkdirCalls: string[] = [];
        const writeCalls: string[] = [];

        const target: MobilePreviewFixtureSeedTarget = {
            async readFile(path) {
                const normalizedPath = normalizeMobilePreviewFixturePath(path);
                const content = files.get(normalizedPath);
                if (content == null) {
                    throw new Error(`ENOENT: ${normalizedPath}`);
                }
                return content;
            },
            async writeFile(path, content) {
                const normalizedPath = normalizeMobilePreviewFixturePath(path);
                files.set(normalizedPath, content);
                writeCalls.push(normalizedPath);
            },
            async mkdir(path) {
                mkdirCalls.push(normalizeMobilePreviewFixturePath(path));
            },
        };

        return { files, mkdirCalls, target, writeCalls };
    }

    describe('seedMobilePreviewFixture', () => {
        test('creates the fixture tree for an empty target', async () => {
            const harness = createMemoryTarget();

            const result = await seedMobilePreviewFixture(harness.target, {
                basePath: '/workspace/app',
            });

            expect(result.createdPaths).toHaveLength(
                MOBILE_PREVIEW_E2E_FIXTURE.files.length,
            );
            expect(result.updatedPaths).toHaveLength(0);
            expect(result.unchangedPaths).toHaveLength(0);
            expect(harness.files.get('workspace/app/index.ts')).toContain(
                "AppRegistry.registerComponent('main'",
            );
            expect(harness.mkdirCalls).toContain('workspace');
            expect(harness.mkdirCalls).toContain('workspace/app');
            expect(harness.mkdirCalls).toContain('workspace/app/components');
        });

        test('is idempotent when the fixture is already present', async () => {
            const harness = createMemoryTarget();

            await seedMobilePreviewFixture(harness.target, { basePath: 'fixture' });
            const writesAfterFirstSeed = harness.writeCalls.length;

            const secondPass = await seedMobilePreviewFixture(harness.target, {
                basePath: 'fixture',
            });

            expect(secondPass.createdPaths).toHaveLength(0);
            expect(secondPass.updatedPaths).toHaveLength(0);
            expect(secondPass.unchangedPaths).toHaveLength(
                MOBILE_PREVIEW_E2E_FIXTURE.files.length,
            );
            expect(harness.writeCalls).toHaveLength(writesAfterFirstSeed);
        });

        test('updates drifted files in place', async () => {
            const harness = createMemoryTarget({
                'fixture/App.tsx': 'export default function App() { return null; }\n',
            });

            const result = await seedMobilePreviewFixture(harness.target, {
                basePath: 'fixture',
            });

            expect(result.updatedPaths).toContain('fixture/App.tsx');
            expect(harness.files.get('fixture/App.tsx')).toContain('FixtureCard');
        });
    });
}
