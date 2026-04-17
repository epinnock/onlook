import { describe, expect, test } from 'bun:test';

interface ShellModule {
    bootstrapShell?: (target: RuntimeHarness) => RuntimeHarness;
    default?: {
        bootstrapShell?: (target: RuntimeHarness) => RuntimeHarness;
    };
}

interface ReactElementShape {
    type: string;
    props: Record<string, unknown>;
    children: unknown[];
}

interface ReactLike {
    createElement: (
        type: string,
        props?: Record<string, unknown>,
        ...children: unknown[]
    ) => ReactElementShape;
}

interface WebSocketLike {
    addListener: (eventName: string) => void;
    connect: (url: string, protocols: unknown[], options: Record<string, unknown>, socketId: number) => void;
    send: (payload: string, socketId: number) => void;
}

interface RuntimeHarness {
    React: ReactLike;
    RN$AppRegistry?: {
        runApplication: (appKey: string, props: { rootTag: number }) => void;
    };
    RN$registerCallableModule: (
        name: string,
        factory: () => Record<string, (...args: unknown[]) => void>,
    ) => void;
    _initReconciler: (fabric: unknown, rootTag: number) => void;
    _log?: (message: string) => void;
    _tryConnectWebSocket?: (host: string, port: number) => void;
    currentRootTag?: number | null;
    fab?: { registerEventHandler: (handler: () => void) => void };
    global?: RuntimeHarness;
    nativeFabricUIManager: { registerEventHandler: (handler: () => void) => void };
    nativeLoggingHook: (message: string, level: number) => void;
    nativeModuleProxy: {
        WebSocketModule: WebSocketLike;
    };
    renderApp: (element: ReactElementShape) => void;
    wsConnected?: boolean;
    wsModule?: WebSocketLike | null;
}

async function loadBootstrapShell() {
    (globalThis as Record<string, unknown>).__ONLOOK_SKIP_SHELL_BOOTSTRAP__ = true;

    try {
        const shellModule = (await import('../shell.js')) as ShellModule;
        const bootstrapShell =
            shellModule.bootstrapShell ?? shellModule.default?.bootstrapShell;

        if (!bootstrapShell) {
            throw new Error('shell.js did not expose bootstrapShell');
        }

        return bootstrapShell;
    } finally {
        delete (globalThis as Record<string, unknown>).__ONLOOK_SKIP_SHELL_BOOTSTRAP__;
    }
}

describe('runtime shell bootstrap', () => {
    test('preserves the bootstrap flow after splitting into focused modules', async () => {
        const bootstrapShell = await loadBootstrapShell();
        const logs: string[] = [];
        const websocketListeners: string[] = [];
        const websocketConnects: Array<{ url: string; socketId: number }> = [];
        const registeredHandlers: Array<() => void> = [];
        const reconcilerCalls: Array<{ fabric: unknown; rootTag: number }> = [];
        const renderedElements: ReactElementShape[] = [];
        const callableModules: Record<string, Record<string, (...args: unknown[]) => void>> = {};

        const websocketModule: WebSocketLike = {
            addListener(eventName) {
                websocketListeners.push(eventName);
            },
            connect(url, _protocols, _options, socketId) {
                websocketConnects.push({ url, socketId });
            },
            send() {},
        };

        const react: ReactLike = {
            createElement(type, props, ...children) {
                return {
                    type,
                    props: props ?? {},
                    children,
                };
            },
        };

        const runtimeHarness: RuntimeHarness = {
            React: react,
            RN$registerCallableModule(name, factory) {
                callableModules[name] = factory();
            },
            _initReconciler(fabric, rootTag) {
                reconcilerCalls.push({ fabric, rootTag });
            },
            nativeFabricUIManager: {
                registerEventHandler(handler) {
                    registeredHandlers.push(handler);
                },
            },
            nativeLoggingHook(message) {
                logs.push(message);
            },
            nativeModuleProxy: {
                WebSocketModule: websocketModule,
            },
            renderApp(element) {
                renderedElements.push(element);
            },
        };

        bootstrapShell(runtimeHarness);

        expect(registeredHandlers).toHaveLength(1);
        expect(runtimeHarness.fab).toBe(runtimeHarness.nativeFabricUIManager);
        expect(Object.keys(callableModules).sort()).toEqual([
            'HMRClient',
            'RCTDeviceEventEmitter',
            'RCTNativeAppEventEmitter',
        ]);

        callableModules.HMRClient?.setup('ios', 'index.bundle', '127.0.0.1', 8081, true, 'ws');
        expect(websocketListeners).toEqual([
            'websocketOpen',
            'websocketMessage',
            'websocketClosed',
            'websocketFailed',
        ]);
        expect(websocketConnects).toEqual([
            { url: 'ws://127.0.0.1:8788', socketId: 42 },
        ]);

        runtimeHarness.RN$AppRegistry?.runApplication('App', { rootTag: 17 });

        expect(runtimeHarness.currentRootTag).toBe(17);
        expect(reconcilerCalls).toEqual([
            { fabric: runtimeHarness.nativeFabricUIManager, rootTag: 17 },
        ]);
        expect(renderedElements).toHaveLength(1);
        expect(renderedElements[0]?.type).toBe('View');
        expect(JSON.stringify(renderedElements[0])).toContain('Onlook Runtime Ready');
        expect(JSON.stringify(renderedElements[0])).toContain('Waiting for component code...');
        expect(logs.some((message) => message.includes('shell ready'))).toBe(true);
    });
});
