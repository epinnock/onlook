// Programmatic allowlist of Expo modules permitted in the mobile client.
// Keep in sync with apps/mobile-client/SUPPORTED_MODULES.md and the
// `no-restricted-imports` rule in apps/mobile-client/eslint.config.mjs.
//
// MC1.8 — Expo module allowlist enforcement (ESLint half).
// The Metro resolver block is deferred to a follow-up task.

export const ALLOWED_EXPO_MODULES = [
    'expo',
    'expo-camera',
    'expo-haptics',
    'expo-secure-store',
] as const;

export type AllowedExpoModule = (typeof ALLOWED_EXPO_MODULES)[number];

export function isAllowedExpoModule(name: string): boolean {
    return ALLOWED_EXPO_MODULES.includes(name as AllowedExpoModule);
}
