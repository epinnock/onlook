import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type FrameLocator, type Page } from '@playwright/test';

import {
    ensureDevLoggedIn,
    openVerificationProject,
    seedVerificationFixture,
    VERIFICATION_PROJECT_ID,
} from '../helpers/browser';

const SCROLL_FIXTURE_APP_TSX = `import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

export default function App() {
  const [scrollY, setScrollY] = useState(0);
  const rows = useMemo(
    () =>
      Array.from({ length: 40 }, (_, index) => ({
        key: String(index),
        label: 'Fixture row ' + String(index + 1),
      })),
    [],
  );

  return (
    <View style={styles.screen}>
      <Text testID="scroll-y" style={styles.metric}>
        scroll-y:{String(scrollY)}
      </Text>
      <ScrollView
        testID="scroll-root"
        style={styles.scroll}
        contentContainerStyle={styles.content}
        scrollEventThrottle={16}
        onScroll={(event) => {
          setScrollY(Math.round(event.nativeEvent.contentOffset.y));
        }}
      >
        {rows.map((row) => (
          <View key={row.key} style={styles.card}>
            <Text style={styles.cardText}>{row.label}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#050816',
    paddingTop: 24,
  },
  metric: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: 12,
    paddingBottom: 32,
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 14,
    minHeight: 96,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  cardText: {
    color: '#cbd5e1',
    fontSize: 16,
    fontWeight: '600',
  },
});
`;

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

    try {
        execFileSync('bash', [setupScriptPath], {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: 'pipe',
            timeout: 300_000,
        });
    } catch (error) {
        const stdout =
            error && typeof error === 'object' && 'stdout' in error
                ? String(error.stdout)
                : '';
        const stderr =
            error && typeof error === 'object' && 'stderr' in error
                ? String(error.stderr)
                : '';

        throw new Error(
            `verification setup failed.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        );
    }
}

function getPreviewFrame(page: Page): FrameLocator {
    return page
        .frameLocator('iframe[id^="frame-"], iframe[src*="/preview/"]')
        .first();
}

async function ensureLoggedIn(page: Page): Promise<void> {
    await ensureDevLoggedIn(page, `/project/${VERIFICATION_PROJECT_ID}`);
}

async function openScrollFixture(page: Page): Promise<{
    frame: FrameLocator;
    consoleErrors: string[];
}> {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') {
            consoleErrors.push(message.text());
        }
    });
    page.on('pageerror', (error) => {
        consoleErrors.push(error.message);
    });

    await ensureLoggedIn(page);
    await openVerificationProject(page, VERIFICATION_PROJECT_ID);

    const editor = page
        .locator('[data-testid="project-editor"], body[data-onlook-loaded="true"]')
        .first();
    await editor.waitFor({ state: 'attached', timeout: 60_000 });

    const previewFrame = page
        .locator('iframe[id^="frame-"], iframe[src*="/preview/"]')
        .first();
    await previewFrame.waitFor({ state: 'attached', timeout: 60_000 });

    const frame = getPreviewFrame(page);
    await frame
        .locator('#root, [data-onlook-preview-ready="true"]')
        .first()
        .waitFor({ state: 'attached', timeout: 30_000 });
    await frame.getByTestId('scroll-root').waitFor({ state: 'attached', timeout: 60_000 });
    await frame.getByTestId('scroll-y').waitFor({ state: 'attached', timeout: 60_000 });

    return { frame, consoleErrors };
}

test.describe('Mobile preview scroll interactions', () => {
    test.beforeAll(async () => {
        const repoRoot = resolveRepoRoot();

        runVerificationSetup(repoRoot);
        seedVerificationFixture(repoRoot, { 'App.tsx': SCROLL_FIXTURE_APP_TSX });
    });

    test('updates the fixture scroll metric when the preview scroll view scrolls', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        const { frame, consoleErrors } = await openScrollFixture(page);

        await expect(frame.getByTestId('scroll-y')).toContainText('scroll-y:0');

        await frame.getByTestId('scroll-root').evaluate((node) => {
            if (!(node instanceof HTMLElement)) {
                throw new Error('Expected scroll-root to resolve to an HTMLElement.');
            }

            node.scrollTop = 240;
            node.dispatchEvent(new Event('scroll', { bubbles: true }));
        });

        await expect
            .poll(
                async () => {
                    const text =
                        (await frame.getByTestId('scroll-y').textContent())?.trim() ?? '';
                    const match = text.match(/scroll-y:(-?\d+)/);
                    return match ? Number.parseInt(match[1] ?? '0', 10) : 0;
                },
                { timeout: 15_000 },
            )
            .toBeGreaterThan(0);

        const scrollErrors = consoleErrors.filter(
            (line) =>
                /onScroll|ScrollView|scroll/i.test(line) &&
                !/Encountered two children with the same key/i.test(line),
        );
        expect(
            scrollErrors,
            'Preview scroll interaction should not surface scroll-related runtime warnings.',
        ).toEqual([]);
    });
});
