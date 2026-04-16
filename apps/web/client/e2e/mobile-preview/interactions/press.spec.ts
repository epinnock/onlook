import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Frame, type Page } from '@playwright/test';

import {
    ensureDevLoggedIn,
    openVerificationProject,
    seedVerificationFixture,
    VERIFICATION_PROJECT_ID,
} from '../helpers/browser';

const PRESS_FIXTURE_APP_TSX = `import { useState } from 'react';
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

export default function App() {
  const [pressableState, setPressableState] = useState('idle');
  const [pressableSequence, setPressableSequence] = useState<string[]>([]);
  const [opacityCount, setOpacityCount] = useState(0);
  const [highlightCount, setHighlightCount] = useState(0);
  const [withoutFeedbackCount, setWithoutFeedbackCount] = useState(0);
  const [buttonCount, setButtonCount] = useState(0);

  const appendSequence = (value: string) => {
    setPressableSequence((current) => [...current, value]);
  };

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
          setPressableState('press-in');
          appendSequence('in');
        }}
        onPressOut={() => {
          setPressableState('press-out');
          appendSequence('out');
        }}
        onPress={() => {
          setPressableState('pressed');
          appendSequence('press');
        }}
        style={styles.primaryTarget}
      >
        <Text style={styles.targetLabel}>Pressable target</Text>
      </Pressable>

      <TouchableOpacity
        onPress={() => setOpacityCount((count) => count + 1)}
        style={styles.secondaryTarget}
      >
        <Text style={styles.targetLabel}>TouchableOpacity target</Text>
      </TouchableOpacity>

      <TouchableHighlight
        onPress={() => setHighlightCount((count) => count + 1)}
        style={styles.secondaryTarget}
        underlayColor="#334155"
      >
        <View>
          <Text style={styles.targetLabel}>TouchableHighlight target</Text>
        </View>
      </TouchableHighlight>

      <TouchableWithoutFeedback
        onPress={() => setWithoutFeedbackCount((count) => count + 1)}
      >
        <View style={styles.secondaryTarget}>
          <Text style={styles.targetLabel}>TouchableWithoutFeedback target</Text>
        </View>
      </TouchableWithoutFeedback>

      <View style={styles.buttonWrap}>
        <Button
          title="Button target"
          onPress={() => setButtonCount((count) => count + 1)}
        />
      </View>
    </View>
  );
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

async function uploadPressFixture(): Promise<void> {
    const repoRoot = resolveRepoRoot();
    seedVerificationFixture(repoRoot, { 'App.tsx': PRESS_FIXTURE_APP_TSX });
}

async function ensureLoggedIn(page: Page): Promise<void> {
    await ensureDevLoggedIn(page, `/project/${VERIFICATION_PROJECT_ID}`);
}

async function openPreviewFrame(page: Page): Promise<Frame> {
    await openVerificationProject(page, VERIFICATION_PROJECT_ID);

    const editor = page
        .locator('[data-testid="project-editor"], body[data-onlook-loaded="true"]')
        .first();
    await editor.waitFor({ state: 'attached', timeout: 90_000 });

    const previewFrameElement = page
        .locator('iframe[id^="frame-"], iframe[src*="/preview/"]')
        .first();
    await previewFrameElement.waitFor({ state: 'attached', timeout: 60_000 });

    const frameHandle = await previewFrameElement.elementHandle();
    const previewFrame = await frameHandle?.contentFrame();

    if (!previewFrame) {
        throw new Error('Expected the editor preview iframe to expose a frame.');
    }

    return previewFrame;
}

test.describe('Mobile preview press interactions', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeAll(async () => {
        const repoRoot = resolveRepoRoot();
        runVerificationSetup(repoRoot);
        await uploadPressFixture();
    });

    test('dispatches press lifecycle updates for touchable families in the preview frame', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        await ensureLoggedIn(page);

        const previewFrame = await openPreviewFrame(page);
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
