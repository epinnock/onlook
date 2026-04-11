/**
 * Layer C — narrow `runCommand` interceptor for the ExpoBrowserProvider.
 *
 * Wave A (TA.7). Pattern-matches on a closed allowlist of 4 command groups
 * the chat agent actually uses on browser-preview branches:
 *
 *   1. npm install <pkg> / bun add <pkg> / yarn add <pkg>
 *   2. npm uninstall <pkg> / bun remove <pkg> / yarn remove <pkg>
 *   3. npm run dev / npm start / bun run dev / expo start
 *   4. npm run build / expo export / expo export:web
 *
 * Anything else returns the typed PROVIDER_NO_SHELL sentinel so callers
 * (BashRead/EditTool, GitManager, etc.) can detect the error code and
 * adapt. The 5 patterns above are translated to virtual operations on the
 * branch's package.json + a bundler restart hook.
 *
 * **The interceptor is intentionally tiny.** It is NOT a shell. Anything
 * that doesn't match a known pattern fails loudly. The agent system prompt
 * (§0.7) is what teaches the model to use file-edit tools instead of
 * arbitrary terminal_command calls.
 */

import type { TerminalCommandInput, TerminalCommandOutput } from '../../../types';
import { PROVIDER_NO_SHELL } from '../index';

/**
 * Side-effect hooks supplied by the integrating layer. The interceptor
 * itself is pure pattern-matching and string formatting; all real work
 * happens through these callbacks.
 */
export interface InterceptorContext {
    /** Read the branch's package.json contents (raw string). */
    readPackageJson: () => Promise<string>;
    /** Write a new package.json contents (raw string). */
    writePackageJson: (content: string) => Promise<void>;
    /** Optional: prefetch a package through the ESM CDN to warm cache. */
    prefetchPackage?: (name: string, version: string) => Promise<void>;
    /** Trigger a fresh bundle. Used by `npm run dev` / `npm run build`. */
    triggerBundle?: () => Promise<void>;
}

const INSTALL_PATTERN = /^\s*(?:npm\s+install|npm\s+i|bun\s+add|yarn\s+add|pnpm\s+add)\s+(.+?)\s*$/i;
const UNINSTALL_PATTERN = /^\s*(?:npm\s+uninstall|npm\s+remove|npm\s+rm|bun\s+remove|bun\s+rm|yarn\s+remove|pnpm\s+remove)\s+(.+?)\s*$/i;
const DEV_PATTERN = /^\s*(?:npm\s+run\s+dev|npm\s+start|bun\s+run\s+dev|bun\s+start|yarn\s+dev|yarn\s+start|expo\s+start|npx\s+expo\s+start)\s*$/i;
const BUILD_PATTERN = /^\s*(?:npm\s+run\s+build|bun\s+run\s+build|yarn\s+build|expo\s+export(?:\s*:\s*web)?|npx\s+expo\s+export(?:\s*:\s*web)?)\s*$/i;

/**
 * Try to handle a runCommand invocation. Returns a TerminalCommandOutput on
 * match (success OR PROVIDER_NO_SHELL fall-through), so the caller can
 * unconditionally `return await intercept(...)`.
 */
export async function intercept(
    input: TerminalCommandInput,
    ctx: InterceptorContext,
): Promise<TerminalCommandOutput> {
    const cmd = input.args.command;

    const installMatch = cmd.match(INSTALL_PATTERN);
    if (installMatch) {
        return handleInstall(parsePackageList(installMatch[1] ?? ''), ctx);
    }

    const uninstallMatch = cmd.match(UNINSTALL_PATTERN);
    if (uninstallMatch) {
        return handleUninstall(parsePackageList(uninstallMatch[1] ?? ''), ctx);
    }

    if (DEV_PATTERN.test(cmd)) {
        return handleDevOrBuild(ctx, 'dev');
    }

    if (BUILD_PATTERN.test(cmd)) {
        return handleDevOrBuild(ctx, 'build');
    }

    return {
        output: PROVIDER_NO_SHELL,
    };
}

// -- pattern handlers ---------------------------------------------------------

async function handleInstall(
    packages: ParsedPackage[],
    ctx: InterceptorContext,
): Promise<TerminalCommandOutput> {
    if (packages.length === 0) {
        return { output: 'no packages specified' };
    }

    const pkgJson = await readJsonOrEmpty(ctx);
    pkgJson.dependencies ??= {};

    const added: string[] = [];
    for (const { name, version } of packages) {
        // Skip dev/peer flags etc — the regex captures them as "names" but
        // they aren't real packages. Filter anything starting with '-'.
        if (name.startsWith('-')) continue;
        pkgJson.dependencies[name] = version;
        added.push(`${name}@${version}`);
        if (ctx.prefetchPackage) {
            try {
                await ctx.prefetchPackage(name, version);
            } catch {
                // Prefetch failures are non-fatal — the bundler will request
                // the package on demand if needed.
            }
        }
    }

    await ctx.writePackageJson(`${JSON.stringify(pkgJson, null, 4)}\n`);

    return { output: `added ${added.length} package${added.length === 1 ? '' : 's'}: ${added.join(' ')}\n` };
}

async function handleUninstall(
    packages: ParsedPackage[],
    ctx: InterceptorContext,
): Promise<TerminalCommandOutput> {
    if (packages.length === 0) {
        return { output: 'no packages specified' };
    }

    const pkgJson = await readJsonOrEmpty(ctx);
    pkgJson.dependencies ??= {};
    pkgJson.devDependencies ??= {};

    const removed: string[] = [];
    for (const { name } of packages) {
        if (name.startsWith('-')) continue;
        if (pkgJson.dependencies[name] !== undefined) {
            delete pkgJson.dependencies[name];
            removed.push(name);
        } else if (pkgJson.devDependencies[name] !== undefined) {
            delete pkgJson.devDependencies[name];
            removed.push(name);
        }
    }

    await ctx.writePackageJson(`${JSON.stringify(pkgJson, null, 4)}\n`);

    return { output: `removed ${removed.length} package${removed.length === 1 ? '' : 's'}: ${removed.join(' ')}\n` };
}

async function handleDevOrBuild(
    ctx: InterceptorContext,
    verb: 'dev' | 'build',
): Promise<TerminalCommandOutput> {
    if (!ctx.triggerBundle) {
        return {
            output: `[browser-metro] ${verb} requested but bundler not attached (Wave H §1.3 wires this)\n`,
        };
    }
    try {
        await ctx.triggerBundle();
        return { output: `[browser-metro] ${verb} bundle ready\n` };
    } catch (err) {
        return {
            output: `[browser-metro] ${verb} bundle failed: ${formatError(err)}\n`,
        };
    }
}

// -- helpers -----------------------------------------------------------------

interface ParsedPackage {
    name: string;
    version: string;
}

interface PackageJsonShape {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    [key: string]: unknown;
}

/**
 * Split a package list string ('react react-dom expo@52.0.0 -D') into
 * structured entries. Strips flags; respects `<name>@<version>` syntax.
 */
function parsePackageList(raw: string): ParsedPackage[] {
    return raw
        .split(/\s+/)
        .filter((token) => token.length > 0)
        .map((token) => {
            // Scoped packages like @react-navigation/native need special
            // handling: the leading @ isn't a version separator.
            const isScoped = token.startsWith('@');
            const versionIndex = isScoped ? token.indexOf('@', 1) : token.indexOf('@');
            if (versionIndex === -1) {
                return { name: token, version: 'latest' };
            }
            return {
                name: token.slice(0, versionIndex),
                version: token.slice(versionIndex + 1) || 'latest',
            };
        });
}

async function readJsonOrEmpty(ctx: InterceptorContext): Promise<PackageJsonShape> {
    try {
        const raw = await ctx.readPackageJson();
        return JSON.parse(raw) as PackageJsonShape;
    } catch {
        return {};
    }
}

function formatError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
}
