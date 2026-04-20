import { ONLOOK_RUNTIME_VERSION } from '@onlook/mobile-client-protocol';

export interface DebugInfo {
    sessionId: string | null;
    relayHost: string | null;
    clientVersion: string;
    runtimeVersion: string;
    manifest: unknown | null;
    recentLogs: string[];
}

const LOG_BUFFER_CAP = 50;

export class DebugInfoCollector {
    private sessionId: string | null = null;
    private relayHost: string | null = null;
    private manifest: unknown | null = null;
    private logs: string[] = [];

    addLog(line: string): void {
        this.logs.push(line);
        if (this.logs.length > LOG_BUFFER_CAP) this.logs.shift();
    }

    setSession(sessionId: string, relayHost: string): void {
        this.sessionId = sessionId;
        this.relayHost = relayHost;
    }

    setManifest(manifest: unknown): void {
        this.manifest = manifest;
    }

    clear(): void {
        this.sessionId = null;
        this.relayHost = null;
        this.manifest = null;
        this.logs = [];
    }

    collect(): DebugInfo {
        return {
            sessionId: this.sessionId,
            relayHost: this.relayHost,
            clientVersion: ONLOOK_RUNTIME_VERSION,
            runtimeVersion: ONLOOK_RUNTIME_VERSION,
            manifest: this.manifest,
            recentLogs: [...this.logs],
        };
    }
}

export const debugInfoCollector = new DebugInfoCollector();
