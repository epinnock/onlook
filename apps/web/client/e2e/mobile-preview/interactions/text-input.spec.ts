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

const TEXT_INPUT_FIXTURE_APP_TSX = `import React from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

const INITIAL_VALUE = 'seed value';

interface TextInputFixtureState {
  value: string;
}

export default class App extends React.Component<Record<string, never>, TextInputFixtureState> {
  state: TextInputFixtureState = {
    value: INITIAL_VALUE,
  };

  render() {
    const { value } = this.state;
    const derived = value.toUpperCase();

    return (
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <Text style={styles.heading}>Text input round-trip</Text>
          <TextInput
            accessibilityLabel="Fixture input"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(nextValue) => this.setState({ value: nextValue })}
            placeholder="Type into the preview"
            style={styles.input}
            testID="text-input-field"
            value={value}
          />
          <Text style={styles.line} testID="text-input-echo">
            echo:{value}
          </Text>
          <Text style={styles.line} testID="text-input-length">
            length:{String(value.length)}
          </Text>
          <Text style={styles.line} testID="text-input-derived">
            derived:{derived}
          </Text>
        </View>
      </ScrollView>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
    backgroundColor: '#050816',
  },
  card: {
    borderRadius: 18,
    backgroundColor: '#111827',
    paddingHorizontal: 18,
    paddingVertical: 20,
    gap: 10,
  },
  heading: {
    color: '#f9fafb',
    fontSize: 22,
    fontWeight: '700',
  },
  input: {
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    color: '#111827',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  line: {
    color: '#cbd5e1',
    fontSize: 14,
  },
});
`;

function resolveRepoRoot(): string {
    const cwd = process.cwd();
    const rootFromCwd = path.join(cwd, 'apps/web/client/e2e/mobile-preview/helpers/browser.ts');

    if (existsSync(rootFromCwd)) {
        return cwd;
    }

    const rootFromApp = path.resolve(cwd, '../../..');
    if (
        existsSync(
            path.join(
                rootFromApp,
                'apps/web/client/e2e/mobile-preview/helpers/browser.ts',
            ),
        )
    ) {
        return rootFromApp;
    }

    throw new Error(`Unable to resolve repo root from cwd: ${cwd}`);
}

async function openTextInputFixture(page: Page): Promise<FrameLocator> {
    await ensureDevLoggedIn(page, `/project/${EXPO_BROWSER_TEST_BRANCH.projectId}`);
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

    const frame = page
        .frameLocator('iframe[id^="frame-"], iframe[src*="/preview/"]')
        .first();
    await frame.getByTestId('text-input-field').waitFor({
        state: 'attached',
        timeout: 60_000,
    });

    return frame;
}

async function enablePreviewInteractionMode(page: Page): Promise<void> {
    const previewMode = page.getByRole('radio', { name: /^Preview$/ }).first();

    await expect(previewMode).toBeVisible({ timeout: 30_000 });
    await previewMode.click();
    await expect(previewMode).toBeChecked({ timeout: 10_000 });
}

test.describe('Mobile preview text input interactions', () => {
    test.beforeAll(async () => {
        const repoRoot = resolveRepoRoot();

        seedExpoBrowserTestBranch();
        seedVerificationFixture(
            repoRoot,
            {
                'App.tsx': TEXT_INPUT_FIXTURE_APP_TSX,
            },
            EXPO_BROWSER_TEST_BRANCH.projectId,
            EXPO_BROWSER_TEST_BRANCH.branchId,
        );
    });

    test('round-trips typed text through the preview TextInput', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        const typedText = 'mobile preview round trip';
        const frame = await openTextInputFixture(page);
        await enablePreviewInteractionMode(page);
        const input = frame.getByTestId('text-input-field');

        await expect(frame.getByTestId('text-input-echo')).toContainText(
            'echo:seed value',
        );
        await input.fill(typedText);
        await expect(frame.getByTestId('text-input-echo')).toContainText(
            `echo:${typedText}`,
        );
        await expect(frame.getByTestId('text-input-length')).toContainText(
            `length:${typedText.length}`,
        );
        await expect(frame.getByTestId('text-input-derived')).toContainText(
            `derived:${typedText.toUpperCase()}`,
        );
    });
});
