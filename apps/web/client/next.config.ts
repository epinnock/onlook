/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import { NextConfig } from 'next';
import fs from 'node:fs';
import createNextIntlPlugin from 'next-intl/plugin';
import path from 'node:path';
import './src/env';

function resolveWorkspaceRoot(startDir: string) {
    let currentDir = startDir;

    while (true) {
        if (fs.existsSync(path.join(currentDir, 'node_modules/next/package.json'))) {
            return currentDir;
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            return startDir;
        }

        currentDir = parentDir;
    }
}

const workspaceRoot = resolveWorkspaceRoot(__dirname);

const nextConfig: NextConfig = {
    devIndicators: false,
    ...(process.env.STANDALONE_BUILD === 'true' && { output: 'standalone' }),
    turbopack: {
        root: workspaceRoot,
    },
};

if (process.env.NODE_ENV === 'development') {
    nextConfig.outputFileTracingRoot = workspaceRoot;
}

const withNextIntl = createNextIntlPlugin({
    experimental: {
        createMessagesDeclaration: './messages/en.json'
    }
});
export default withNextIntl(nextConfig);
