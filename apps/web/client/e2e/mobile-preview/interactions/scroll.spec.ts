import { existsSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type FrameLocator, type Page } from '@playwright/test';

import { EXPO_BROWSER_TEST_BRANCH } from '../../fixtures/test-branch';
import { seedExpoBrowserTestBranch } from '../../expo-browser/helpers/setup';
import {
    ensureDevLoggedIn,
    openVerificationProject,
    seedVerificationFixture,
} from '../helpers/browser';

const SCROLL_FIXTURE_APP_TSX = `import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

const ROWS = Array.from({ length: 40 }, (_, index) => ({
  key: String(index),
  label: 'Fixture row ' + String(index + 1),
}));

interface ScrollFixtureState {
  scrollY: number;
}

export default class App extends React.Component<Record<string, never>, ScrollFixtureState> {
  state: ScrollFixtureState = {
    scrollY: 0,
  };

  render() {
    return (
      <View style={styles.screen}>
        <Text testID="scroll-y" style={styles.metric}>
          scroll-y:{String(this.state.scrollY)}
        </Text>
        <ScrollView
          testID="scroll-root"
          style={styles.scroll}
          contentContainerStyle={styles.content}
          scrollEventThrottle={16}
          onScroll={(event) => {
            this.setState({
              scrollY: Math.round(event.nativeEvent.contentOffset.y),
            });
          }}
        >
          {ROWS.map((row) => (
            <View key={row.key} style={styles.card}>
              <Text style={styles.cardText}>{row.label}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    height: 480,
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
    height: 360,
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

function getPreviewFrame(page: Page): FrameLocator {
    return page
        .frameLocator('iframe[id^="frame-"], iframe[src*="/preview/"]')
        .first();
}

async function ensureLoggedIn(page: Page): Promise<void> {
    await ensureDevLoggedIn(page, `/project/${EXPO_BROWSER_TEST_BRANCH.projectId}`);
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
    await openVerificationProject(page, EXPO_BROWSER_TEST_BRANCH.projectId);

    await page
        .getByText('Loading project...')
        .waitFor({ state: 'hidden', timeout: 120_000 })
        .catch(() => undefined);
    await expect(page.getByTestId('preview-on-device-button')).toBeVisible({
        timeout: 60_000,
    });

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

        seedExpoBrowserTestBranch();
        seedVerificationFixture(
            repoRoot,
            { 'App.tsx': SCROLL_FIXTURE_APP_TSX },
            EXPO_BROWSER_TEST_BRANCH.projectId,
            EXPO_BROWSER_TEST_BRANCH.branchId,
        );
    });

    test('updates the fixture scroll metric when the preview scroll view scrolls', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        const { frame, consoleErrors } = await openScrollFixture(page);

        await expect(frame.getByTestId('scroll-y')).toContainText('scroll-y:0');

        const scrollInfo = await frame.getByTestId('scroll-root').evaluate((node) => {
            if (!(node instanceof HTMLElement)) {
                throw new Error('Expected scroll-root to resolve to an HTMLElement.');
            }

            node.scrollTop = 240;
            node.dispatchEvent(new Event('scroll', { bubbles: true }));
            return {
                clientHeight: node.clientHeight,
                scrollHeight: node.scrollHeight,
                scrollTop: node.scrollTop,
            };
        });
        expect(scrollInfo.scrollTop).toBeGreaterThan(0);

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
