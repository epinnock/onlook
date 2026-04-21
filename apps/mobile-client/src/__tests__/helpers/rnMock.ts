/**
 * Shared `react-native` mock stubs for bun-test.
 *
 * bun's `mock.module('react-native', ...)` is process-wide and has no
 * restore hook — once a test file installs a mock at top level, it
 * stays for every subsequent test file in the same `bun test` run.
 * Individual test files used to register narrow mocks that omitted
 * symbols used by OTHER test files (Alert, FlatList, ActivityIndicator,
 * etc.) — so the test process would cross-contaminate and downstream
 * tests would fail with "Export named X not found in module".
 *
 * This helper exports a factory that returns a comprehensive-enough
 * stub covering every `react-native` symbol imported anywhere in
 * `apps/mobile-client/src`. Test files spread it and override just
 * the symbols they actually need to observe:
 *
 * ```ts
 * import { rnMockStubs } from '../../__tests__/helpers/rnMock';
 * const reloadSpy = mock(() => {});
 * mock.module('react-native', () => ({
 *     ...rnMockStubs(),
 *     DevSettings: { reload: reloadSpy },
 * }));
 * ```
 *
 * Intentional: this is runtime-shape-only; types come from
 * `@types/react-native` via tsconfig, not from these stubs.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Stub = Record<string, any>;

const noopComponent = (): null => null;
const noopFn: AnyFn = () => {};

/** Comprehensive react-native stub shape. Spread and override per test. */
export function rnMockStubs(): Stub {
    return {
        // Components used anywhere in apps/mobile-client/src
        ActivityIndicator: noopComponent,
        FlatList: noopComponent,
        KeyboardAvoidingView: noopComponent,
        Modal: noopComponent,
        Pressable: noopComponent,
        SafeAreaView: noopComponent,
        ScrollView: noopComponent,
        Text: noopComponent,
        TextInput: noopComponent,
        TouchableOpacity: noopComponent,
        View: noopComponent,

        // APIs
        Alert: { alert: noopFn },
        Clipboard: { setString: noopFn, getString: () => Promise.resolve('') },
        DevSettings: { reload: noopFn, addMenuItem: noopFn },
        Linking: {
            getInitialURL: () => Promise.resolve(null),
            addEventListener: (_event: string, _handler: AnyFn) => ({
                remove: noopFn,
            }),
            openURL: (_url: string) => Promise.resolve(true),
            canOpenURL: (_url: string) => Promise.resolve(true),
        },
        NativeEventEmitter: class {
            addListener() {
                return { remove: noopFn };
            }
        },
        NativeModules: new Proxy(
            {},
            {
                get: () => new Proxy({}, { get: () => noopFn }),
            },
        ),
        PanResponder: { create: () => ({ panHandlers: {} }) },
        Platform: { OS: 'ios', select: (m: Stub) => m.ios ?? m.default },
        StyleSheet: {
            create: (s: Stub) => s,
            flatten: (s: Stub) => s,
            hairlineWidth: 1,
            absoluteFillObject: {},
            compose: (a: Stub, b: Stub) => [a, b],
        },
        UIManager: { findNodeHandle: () => null },
    };
}
