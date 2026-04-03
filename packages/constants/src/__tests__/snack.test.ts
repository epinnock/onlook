import { describe, expect, it } from 'bun:test';
import {
    SNACK_BLANK_TEMPLATE,
    SNACK_DEFAULT_SDK_VERSION,
    SNACK_DOMAIN,
    SNACK_WEB_PLAYER_BASE_URL,
    getSnackWebPreviewUrl,
} from '../snack';

describe('Snack constants', () => {
    it('exports the expected SDK version', () => {
        expect(SNACK_DEFAULT_SDK_VERSION).toBe('52.0.0');
    });

    it('exports the expected web player base URL', () => {
        expect(SNACK_WEB_PLAYER_BASE_URL).toBe('https://snack.expo.dev/embedded');
    });

    it('exports the expected domain', () => {
        expect(SNACK_DOMAIN).toBe('snack.expo.dev');
    });
});

describe('SNACK_BLANK_TEMPLATE', () => {
    it('has a name', () => {
        expect(SNACK_BLANK_TEMPLATE.name).toBe('Blank Expo Project');
    });

    it('contains App.tsx with CODE type', () => {
        const appFile = SNACK_BLANK_TEMPLATE.files['App.tsx'];
        expect(appFile).toBeDefined();
        expect(appFile.type).toBe('CODE');
    });

    it('App.tsx contents include the Scry IDE greeting', () => {
        const appFile = SNACK_BLANK_TEMPLATE.files['App.tsx'];
        expect(appFile.contents).toContain('Hello from Scry IDE!');
    });

    it('declares expo, expo-status-bar, and react-native dependencies', () => {
        const deps = SNACK_BLANK_TEMPLATE.dependencies;
        expect(deps['expo']).toEqual({ version: '~52.0.0' });
        expect(deps['expo-status-bar']).toEqual({ version: '~3.0.0' });
        expect(deps['react-native']).toEqual({ version: '0.76.0' });
    });
});

describe('getSnackWebPreviewUrl', () => {
    it('returns the correct URL for a given snack ID', () => {
        const url = getSnackWebPreviewUrl('abc123');
        expect(url).toBe('https://snack.expo.dev/embedded/@snack/abc123');
    });

    it('handles IDs with special characters', () => {
        const url = getSnackWebPreviewUrl('my-snack_v2');
        expect(url).toBe('https://snack.expo.dev/embedded/@snack/my-snack_v2');
    });
});
