import type { SnackProviderOptions } from './types';
export type { SnackProviderOptions } from './types';
export type { SnackSessionInfo } from './types';

// Stub — Phase 2 (T2.1) will implement all abstract methods
export class SnackProvider {
    constructor(public readonly options: SnackProviderOptions) {}
}
