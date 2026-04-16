import { existsSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type FrameLocator, type Page } from '@playwright/test';

import {
    ensureDevLoggedIn,
    openVerificationProject,
    seedVerificationFixture,
    VERIFICATION_PROJECT_ID,
} from '../helpers/browser';

const TEXT_INPUT_FIXTURE_APP_TSX = `import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

const INITIAL_VALUE = 'seed value';

export default function App() {
  const [value, setValue] = useState(INITIAL_VALUE);
  const derived = useMemo(() => value.toUpperCase(), [value]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.heading}>Text input round-trip</Text>
        <TextInput
          accessibilityLabel="Fixture input"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setValue}
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
    await ensureDevLoggedIn(page, `/project/${VERIFICATION_PROJECT_ID}`);
    await openVerificationProject(page, VERIFICATION_PROJECT_ID);

    const editor = page
        .locator('[data-testid="project-editor"], body[data-onlook-loaded="true"]')
        .first();
    await editor.waitFor({ state: 'attached', timeout: 60_000 });

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

test.describe('Mobile preview text input interactions', () => {
    test.beforeAll(async () => {
        const repoRoot = resolveRepoRoot();

        seedVerificationFixture(repoRoot, {
            'App.tsx': TEXT_INPUT_FIXTURE_APP_TSX,
        });
    });

    test('round-trips typed text through the preview TextInput', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        const typedText = 'mobile preview round trip';
        const frame = await openTextInputFixture(page);
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
