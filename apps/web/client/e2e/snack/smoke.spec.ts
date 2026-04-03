import { describe, expect, test } from 'bun:test';
import { createMockSnack } from './helpers/mock-snack';

describe('Snack Mock Infrastructure', () => {
    test('create mock snack with default state', () => {
        const snack = createMockSnack();
        const state = snack.getState();

        expect(state.files).toEqual({});
        expect(state.dependencies).toEqual({});
        expect(state.online).toBe(true);
    });

    test('updateFiles modifies state', () => {
        const snack = createMockSnack();
        snack.updateFiles({ 'App.tsx': { type: 'CODE', contents: 'export default () => null' } });

        const state = snack.getState();
        expect('App.tsx' in state.files).toBe(true);
        expect(state.files['App.tsx'].contents).toBe('export default () => null');
    });

    test('delete file by setting null', () => {
        const snack = createMockSnack({
            'App.tsx': { type: 'CODE', contents: 'hello' },
            'utils.ts': { type: 'CODE', contents: 'world' },
        });

        snack.updateFiles({ 'App.tsx': null });

        const state = snack.getState();
        expect('App.tsx' in state.files).toBe(false);
        expect('utils.ts' in state.files).toBe(true);
    });

    test('state listeners fire on update', () => {
        const snack = createMockSnack();
        let receivedState: any = null;

        snack.addStateListener((state: any) => {
            receivedState = state;
        });

        snack.updateFiles({ 'index.ts': { type: 'CODE', contents: 'console.log("hi")' } });

        expect(receivedState).not.toBeNull();
        expect('index.ts' in receivedState.files).toBe(true);
    });

    test('log listeners receive messages', () => {
        const snack = createMockSnack();
        const logs: string[] = [];

        snack.addLogListener((log: any) => {
            logs.push(log.message);
        });

        snack._emitLog('Hello from device');
        snack._emitLog('Second log');

        expect(logs).toEqual(['Hello from device', 'Second log']);
    });

    test('getUrlAsync returns expo URL', async () => {
        const snack = createMockSnack();
        const url = await snack.getUrlAsync();

        expect(url).toBe('exp://exp.host/@snack/test-123');
    });

    test('dependencies can be updated', () => {
        const snack = createMockSnack();

        snack.updateDependencies({ 'react-native': { version: '0.72.0' } });
        snack.updateDependencies({ expo: { version: '~49.0.0' } });

        const state = snack.getState();
        expect(state.dependencies).toHaveProperty('react-native');
        expect(state.dependencies).toHaveProperty('expo');
        expect(state.dependencies['react-native'].version).toBe('0.72.0');
    });
});
