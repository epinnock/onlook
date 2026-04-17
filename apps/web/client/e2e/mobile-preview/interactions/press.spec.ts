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

const PRESS_FIXTURE_APP_TSX = `import React from 'react';
import {
  Button,
  Pressable,
  StyleSheet,
  Text,
  TouchableHighlight,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

interface PressFixtureState {
  pressableState: string;
  pressableSequence: string[];
  opacityCount: number;
  highlightCount: number;
  withoutFeedbackCount: number;
  buttonCount: number;
}

export default class App extends React.Component<Record<string, never>, PressFixtureState> {
  state: PressFixtureState = {
    pressableState: 'idle',
    pressableSequence: [],
    opacityCount: 0,
    highlightCount: 0,
    withoutFeedbackCount: 0,
    buttonCount: 0,
  };

  appendSequence = (value: string) => {
    this.setState((current) => ({
      pressableSequence: [...current.pressableSequence, value],
    }));
  };

  render() {
    const {
      pressableState,
      pressableSequence,
      opacityCount,
      highlightCount,
      withoutFeedbackCount,
      buttonCount,
    } = this.state;

    return (
      <View style={styles.screen}>
        <Text style={styles.heading}>Wave B press interactions</Text>
        <Text style={styles.line}>pressableState:{pressableState}</Text>
        <Text style={styles.line}>
          pressableSequence:{pressableSequence.length > 0 ? pressableSequence.join('>') : 'idle'}
        </Text>
        <Text style={styles.line}>touchableOpacity:{opacityCount}</Text>
        <Text style={styles.line}>touchableHighlight:{highlightCount}</Text>
        <Text style={styles.line}>touchableWithoutFeedback:{withoutFeedbackCount}</Text>
        <Text style={styles.line}>buttonPresses:{buttonCount}</Text>

        <Pressable
          onPressIn={() => {
            this.setState({ pressableState: 'press-in' });
            this.appendSequence('in');
          }}
          onPressOut={() => {
            this.setState({ pressableState: 'press-out' });
            this.appendSequence('out');
          }}
          onPress={() => {
            this.setState({ pressableState: 'pressed' });
            this.appendSequence('press');
          }}
          style={styles.primaryTarget}
        >
          <Text style={styles.targetLabel}>Pressable target</Text>
        </Pressable>

        <TouchableOpacity
          onPress={() =>
            this.setState((current) => ({ opacityCount: current.opacityCount + 1 }))
          }
          style={styles.secondaryTarget}
        >
          <Text style={styles.targetLabel}>TouchableOpacity target</Text>
        </TouchableOpacity>

        <TouchableHighlight
          onPress={() =>
            this.setState((current) => ({
              highlightCount: current.highlightCount + 1,
            }))
          }
          style={styles.secondaryTarget}
          underlayColor="#334155"
        >
          <View>
            <Text style={styles.targetLabel}>TouchableHighlight target</Text>
          </View>
        </TouchableHighlight>

        <TouchableWithoutFeedback
          onPress={() =>
            this.setState((current) => ({
              withoutFeedbackCount: current.withoutFeedbackCount + 1,
            }))
          }
        >
          <View style={styles.secondaryTarget}>
            <Text style={styles.targetLabel}>TouchableWithoutFeedback target</Text>
          </View>
        </TouchableWithoutFeedback>

        <View style={styles.buttonWrap}>
          <Button
            title="Button target"
            onPress={() =>
              this.setState((current) => ({ buttonCount: current.buttonCount + 1 }))
            }
          />
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#050816',
    alignItems: 'stretch',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  heading: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  line: {
    color: '#cbd5e1',
    fontSize: 14,
    textAlign: 'center',
  },
  primaryTarget: {
    backgroundColor: '#2563eb',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  secondaryTarget: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  targetLabel: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  buttonWrap: {
    marginTop: 4,
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

async function uploadPressFixture(): Promise<void> {
    const repoRoot = resolveRepoRoot();
    seedVerificationFixture(
        repoRoot,
        { 'App.tsx': PRESS_FIXTURE_APP_TSX },
        EXPO_BROWSER_TEST_BRANCH.projectId,
        EXPO_BROWSER_TEST_BRANCH.branchId,
    );
}

async function ensureLoggedIn(page: Page): Promise<void> {
    await ensureDevLoggedIn(page, `/project/${EXPO_BROWSER_TEST_BRANCH.projectId}`);
}

async function openPreviewFrame(page: Page): Promise<FrameLocator> {
    await openVerificationProject(page, EXPO_BROWSER_TEST_BRANCH.projectId);

    await page
        .getByText('Loading project...')
        .waitFor({ state: 'hidden', timeout: 120_000 })
        .catch(() => undefined);
    await expect(page.getByTestId('preview-on-device-button')).toBeVisible({
        timeout: 60_000,
    });

    const previewFrameElement = page
        .locator('iframe[id^="frame-"], iframe[src*="/preview/"]')
        .first();
    await previewFrameElement.waitFor({ state: 'attached', timeout: 60_000 });

    return page
        .frameLocator('iframe[id^="frame-"], iframe[src*="/preview/"]')
        .first();
}

async function enablePreviewInteractionMode(page: Page): Promise<void> {
    const previewMode = page.getByRole('radio', { name: /^Preview$/ }).first();

    await expect(previewMode).toBeVisible({ timeout: 30_000 });
    await previewMode.click();
    await expect(previewMode).toBeChecked({ timeout: 10_000 });
}

test.describe('Mobile preview press interactions', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeAll(async () => {
        seedExpoBrowserTestBranch();
        await uploadPressFixture();
    });

    test('dispatches press lifecycle updates for touchable families in the preview frame', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        await ensureLoggedIn(page);

        const previewFrame = await openPreviewFrame(page);
        await enablePreviewInteractionMode(page);
        await expect(previewFrame.locator('text=Wave B press interactions')).toBeVisible({
            timeout: 120_000,
        });

        await expect(previewFrame.locator('text=pressableState:idle')).toBeVisible();
        await expect(previewFrame.locator('text=pressableSequence:idle')).toBeVisible();
        await expect(previewFrame.locator('text=touchableOpacity:0')).toBeVisible();
        await expect(previewFrame.locator('text=touchableHighlight:0')).toBeVisible();
        await expect(
            previewFrame.locator('text=touchableWithoutFeedback:0'),
        ).toBeVisible();
        await expect(previewFrame.locator('text=buttonPresses:0')).toBeVisible();

        await previewFrame.locator('text=Pressable target').click();
        await expect(previewFrame.locator('text=pressableState:pressed')).toBeVisible({
            timeout: 30_000,
        });
        await expect(
            previewFrame.locator('text=pressableSequence:in>out>press'),
        ).toBeVisible({
            timeout: 30_000,
        });

        await previewFrame.locator('text=TouchableOpacity target').click();
        await expect(previewFrame.locator('text=touchableOpacity:1')).toBeVisible({
            timeout: 30_000,
        });

        await previewFrame.locator('text=TouchableHighlight target').click();
        await expect(previewFrame.locator('text=touchableHighlight:1')).toBeVisible({
            timeout: 30_000,
        });

        await previewFrame.locator('text=TouchableWithoutFeedback target').click();
        await expect(
            previewFrame.locator('text=touchableWithoutFeedback:1'),
        ).toBeVisible({
            timeout: 30_000,
        });

        await previewFrame.locator('text=Button target').click();
        await expect(previewFrame.locator('text=buttonPresses:1')).toBeVisible({
            timeout: 30_000,
        });
    });
});
