import { afterEach, describe, expect, test } from 'bun:test';

const installExpoLocalAuthenticationShim = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/expo-local-authentication.js') as {
    AuthenticationType: {
        FACIAL_RECOGNITION: number;
        FINGERPRINT: number;
        IRIS: number;
    };
    MODULE_ID: string;
    RUNTIME_SHIM_REGISTRY_KEY: string;
    SecurityLevel: {
        BIOMETRIC_STRONG: number;
        BIOMETRIC_WEAK: number;
        NONE: number;
        SECRET: number;
    };
    install: (target: RuntimeTarget) => ExpoLocalAuthenticationModule;
};

const expoRuntimeShimCollection = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/index.js');
const runtimeRegistry = require('../../../../../../../packages/mobile-preview/runtime/registry.js') as {
    applyRuntimeShims: (target: RuntimeTarget) => RuntimeTarget;
    getRegisteredRuntimeShimIds: () => string[];
    registerRuntimeShim: (moduleExports: unknown, fallbackId: string) => void;
    resetRuntimeShimRegistry: () => void;
};

const {
    AuthenticationType,
    MODULE_ID,
    RUNTIME_SHIM_REGISTRY_KEY,
    SecurityLevel,
} = installExpoLocalAuthenticationShim;
const {
    applyRuntimeShims,
    getRegisteredRuntimeShimIds,
    registerRuntimeShim,
    resetRuntimeShimRegistry,
} = runtimeRegistry;

type AuthenticationResult =
    | {
          success: true;
      }
    | {
          error: string;
          success: false;
          warning?: string;
      };

type ExpoLocalAuthenticationModule = {
    AuthenticationType: typeof AuthenticationType;
    SecurityLevel: typeof SecurityLevel;
    __esModule: boolean;
    authenticateAsync: (options?: Record<string, unknown>) => Promise<AuthenticationResult>;
    cancelAuthenticate: () => Promise<void>;
    default: unknown;
    getEnrolledLevelAsync: () => Promise<number>;
    hasHardwareAsync: () => Promise<boolean>;
    isEnrolledAsync: () => Promise<boolean>;
    supportedAuthenticationTypesAsync: () => Promise<number[]>;
};

type NativeLocalAuthenticationModule = {
    authenticateAsync?: (options?: Record<string, unknown>) => Promise<AuthenticationResult>;
    cancelAuthenticate?: () => Promise<string>;
    getEnrolledLevelAsync?: () => Promise<number>;
    hasHardwareAsync?: () => Promise<boolean>;
    isEnrolledAsync?: () => Promise<boolean>;
    supportedAuthenticationTypesAsync?: () => Promise<number[]>;
};

type RuntimeTarget = Record<string, unknown> & {
    __onlookShims?: Record<string, unknown>;
    NativeModules?: Record<string, unknown>;
    TurboModuleRegistry?: {
        get: (name: string) => unknown;
    };
    __onlookNativeModuleBridge?: {
        resolveNativeModule?: (name: string) => unknown;
        resolveTurboModule?: (name: string) => unknown;
    };
    __turboModuleProxy?: ((name: string) => unknown) | Record<string, unknown>;
    nativeModuleProxy?: Record<string, unknown>;
};

afterEach(() => {
    resetRuntimeShimRegistry();
});

describe('expo-local-authentication shim', () => {
    test('installs preview-safe fallbacks into __onlookShims', async () => {
        const target: RuntimeTarget = {};

        const moduleExports = installExpoLocalAuthenticationShim.install(target);

        const registry = (target as Record<string, unknown>)[
            RUNTIME_SHIM_REGISTRY_KEY
        ] as Record<string, unknown> | undefined;
        expect(registry?.[MODULE_ID]).toBe(moduleExports);
        expect(moduleExports.default).toBe(moduleExports);
        expect(moduleExports.__esModule).toBe(true);
        expect(moduleExports.AuthenticationType).toEqual({
            FACIAL_RECOGNITION: 2,
            FINGERPRINT: 1,
            IRIS: 3,
        });
        expect(moduleExports.SecurityLevel).toEqual({
            BIOMETRIC_STRONG: 3,
            BIOMETRIC_WEAK: 2,
            NONE: 0,
            SECRET: 1,
        });
        expect(await moduleExports.hasHardwareAsync()).toBe(false);
        expect(await moduleExports.isEnrolledAsync()).toBe(false);
        expect(await moduleExports.getEnrolledLevelAsync()).toBe(SecurityLevel.NONE);
        expect(await moduleExports.supportedAuthenticationTypesAsync()).toEqual([]);
        expect(await moduleExports.authenticateAsync()).toEqual({
            error: 'not_available',
            success: false,
        });
        expect(await moduleExports.cancelAuthenticate()).toBeUndefined();
    });

    test('resolves the native module lazily after shim installation', async () => {
        const nativeModule: NativeLocalAuthenticationModule = {
            authenticateAsync: async (options) => ({
                success: false,
                error: 'lockout',
                warning:
                    typeof options?.promptMessage === 'string'
                        ? options.promptMessage
                        : undefined,
            }),
            cancelAuthenticate: async () => 'cancelled',
            getEnrolledLevelAsync: async () => SecurityLevel.BIOMETRIC_STRONG,
            hasHardwareAsync: async () => true,
            isEnrolledAsync: async () => true,
            supportedAuthenticationTypesAsync: async () => [
                AuthenticationType.FINGERPRINT,
                AuthenticationType.FACIAL_RECOGNITION,
            ],
        };
        const target: RuntimeTarget = {};

        const moduleExports = installExpoLocalAuthenticationShim.install(target);

        target.NativeModules = {
            ExpoLocalAuthentication: nativeModule,
        };

        expect(await moduleExports.hasHardwareAsync()).toBe(true);
        expect(await moduleExports.isEnrolledAsync()).toBe(true);
        expect(await moduleExports.getEnrolledLevelAsync()).toBe(
            SecurityLevel.BIOMETRIC_STRONG,
        );
        expect(await moduleExports.supportedAuthenticationTypesAsync()).toEqual([
            AuthenticationType.FINGERPRINT,
            AuthenticationType.FACIAL_RECOGNITION,
        ]);
        expect(
            await moduleExports.authenticateAsync({
                promptMessage: 'Use Face ID',
            }),
        ).toEqual({
            error: 'lockout',
            success: false,
            warning: 'Use Face ID',
        });
        expect(await moduleExports.cancelAuthenticate()).toBeUndefined();
    });

    test('merges into an existing expo-local-authentication registry entry', async () => {
        const existingAuthenticateAsync = async () =>
            ({
                success: true,
            }) satisfies AuthenticationResult;
        const target: RuntimeTarget = {
            __onlookShims: {
                'expo-local-authentication': {
                    authenticateAsync: existingAuthenticateAsync,
                },
            },
        };

        const moduleExports = installExpoLocalAuthenticationShim.install(target);

        expect(moduleExports).toBe(
            target.__onlookShims?.['expo-local-authentication'] as ExpoLocalAuthenticationModule,
        );
        expect(moduleExports.authenticateAsync).toBe(existingAuthenticateAsync);
        expect(await moduleExports.hasHardwareAsync()).toBe(false);
        expect(moduleExports.default).toBe(moduleExports);
        expect(moduleExports.__esModule).toBe(true);
    });
});

describe('expo runtime shim auto-discovery', () => {
    test('derives expo-local-authentication from the shim filename', () => {
        const target: RuntimeTarget = {};

        registerRuntimeShim(
            installExpoLocalAuthenticationShim,
            './shims/expo/expo-local-authentication.js',
        );
        registerRuntimeShim(expoRuntimeShimCollection, './shims/expo/index.js');

        applyRuntimeShims(target);

        expect(getRegisteredRuntimeShimIds()).toEqual(['expo-local-authentication']);
        expect(target.__onlookShims?.['expo-local-authentication']).toMatchObject({
            AuthenticationType,
            SecurityLevel,
            __esModule: true,
        });
    });
});
