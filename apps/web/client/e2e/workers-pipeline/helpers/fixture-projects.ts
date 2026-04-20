import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const helperDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(helperDir, '../../../../../..');
export const baseBundleFixtureRoot = join(
    repoRoot,
    'packages/base-bundle-builder/fixtures',
);

export type WorkersPipelineFixtureName = 'hello' | 'tabs-template';

export interface WorkersPipelineFixtureProject {
    readonly name: WorkersPipelineFixtureName;
    readonly rootDir: string;
    readonly entryFile: string;
    readonly packageJsonPath: string;
    readonly appJsonPath: string;
}

export const workersPipelineFixtures: Record<
    WorkersPipelineFixtureName,
    WorkersPipelineFixtureProject
> = {
    hello: createFixtureProject('hello'),
    'tabs-template': createFixtureProject('tabs-template'),
};

export function getWorkersPipelineFixture(
    name: WorkersPipelineFixtureName,
): WorkersPipelineFixtureProject {
    return workersPipelineFixtures[name];
}

export function listWorkersPipelineFixtureFiles(
    fixture: WorkersPipelineFixtureProject,
): string[] {
    return walkFiles(fixture.rootDir).map((filePath) =>
        relative(fixture.rootDir, filePath).replace(/\\/g, '/'),
    );
}

export function readWorkersPipelineFixtureFile(
    fixture: WorkersPipelineFixtureProject,
    relativePath: string,
): string {
    return readFileSync(join(fixture.rootDir, relativePath), 'utf8');
}

function createFixtureProject(name: WorkersPipelineFixtureName): WorkersPipelineFixtureProject {
    const rootDir = join(baseBundleFixtureRoot, name);
    const entryFile = join(rootDir, 'index.ts');
    const packageJsonPath = join(rootDir, 'package.json');
    const appJsonPath = join(rootDir, 'app.json');

    return {
        name,
        rootDir,
        entryFile,
        packageJsonPath,
        appJsonPath,
    };
}

function walkFiles(rootDir: string): string[] {
    if (!existsSync(rootDir)) {
        return [];
    }

    const files: string[] = [];
    for (const entry of readdirSync(rootDir)) {
        const path = join(rootDir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
            files.push(...walkFiles(path));
        } else if (stat.isFile()) {
            files.push(path);
        }
    }
    return files.sort();
}

