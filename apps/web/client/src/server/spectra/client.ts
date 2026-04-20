// `server-only` is enforced at the ingress points that actually bundle
// into a client: the tRPC router (`routers/spectra.ts`) and the Route
// Handlers under `app/api/spectra/**`. Skipping it here keeps the class
// unit-testable via `bun test` without a preload stub. The env-reading
// factory `createSpectraClient()` lives in `factory.ts` so tests can
// import the class without loading `@/env`.

import {
    spectraDeviceSchema,
    spectraOkSchema,
    type SpectraDevice,
} from './types';

/**
 * Thin server-only wrapper around the Spectra REST API. All Onlook →
 * Spectra traffic goes through here; the tRPC router and MJPEG proxy are
 * the only callers.
 *
 * The client is stateless — session lifecycle is tracked by `registry.ts`
 * so a cold reload of the Next.js server loses track of in-flight sims.
 * That's acceptable for v1 (Spectra will idle-reap them) but documented in
 * the ADR as a prod gap.
 */
export class SpectraConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SpectraConfigError';
    }
}

export class SpectraApiError extends Error {
    readonly status: number;
    readonly body: string;
    constructor(status: number, body: string, message: string) {
        super(message);
        this.name = 'SpectraApiError';
        this.status = status;
        this.body = body;
    }
}

export interface SpectraClientOptions {
    baseUrl: string;
    token?: string;
    fetchImpl?: typeof fetch;
}

export class SpectraClient {
    private readonly baseUrl: string;
    private readonly token: string | undefined;
    private readonly fetchImpl: typeof fetch;

    constructor(opts: SpectraClientOptions) {
        if (!opts.baseUrl) {
            throw new SpectraConfigError(
                'SPECTRA_API_URL is not set — Spectra preview cannot be used without a configured API.',
            );
        }
        this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
        this.token = opts.token;
        this.fetchImpl = opts.fetchImpl ?? fetch;
    }

    /** Creates a simulator, optionally auto-installing an app by UUID. */
    async createSimulator(args: {
        name: string;
        installAppId?: string;
        iosRuntime?: string;
        iosDeviceType?: string;
    }): Promise<SpectraDevice> {
        const body = await this.request('POST', '/v1/devices', {
            platform: 'ios',
            iosKind: 'simulator',
            name: args.name,
            installAppId: args.installAppId,
            iosRuntime: args.iosRuntime,
            iosDeviceType: args.iosDeviceType,
        });
        return spectraDeviceSchema.parse(body);
    }

    /** Push a deep link (e.g. `onlook://launch?...`) into the device. */
    async openUrl(deviceId: string, url: string): Promise<void> {
        await this.request('POST', `/v1/devices/${encodeURIComponent(deviceId)}/open-url`, { url });
    }

    /**
     * Send a tap. Coordinates are normalized `[0..1]` — Spectra multiplies
     * by the device's screen size itself.
     */
    async tap(deviceId: string, x: number, y: number): Promise<void> {
        const body = await this.request('POST', `/v1/devices/${encodeURIComponent(deviceId)}/tap`, { x, y });
        spectraOkSchema.parse(body);
    }

    async swipe(
        deviceId: string,
        args: { x1: number; y1: number; x2: number; y2: number; durationMs?: number },
    ): Promise<void> {
        const body = await this.request('POST', `/v1/devices/${encodeURIComponent(deviceId)}/swipe`, args);
        spectraOkSchema.parse(body);
    }

    /** Tear down the simulator. Safe to call on an unknown id (returns 404). */
    async deleteDevice(deviceId: string): Promise<void> {
        await this.request('DELETE', `/v1/devices/${encodeURIComponent(deviceId)}`, undefined, {
            tolerate404: true,
        });
    }

    /** Lightweight reachability probe. Returns false instead of throwing. */
    async health(): Promise<boolean> {
        try {
            const res = await this.fetchImpl(`${this.baseUrl}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(3000),
            });
            return res.ok;
        } catch {
            return false;
        }
    }

    /** Raw fetch URL for the MJPEG proxy route. Only called from server-side proxy. */
    mjpegUrl(deviceId: string): string {
        return `${this.baseUrl}/v1/devices/${encodeURIComponent(deviceId)}/mjpeg`;
    }

    /** Auth headers — token-less when SPECTRA_API_TOKEN is unset. */
    get authHeaders(): HeadersInit {
        return this.token ? { Authorization: `Bearer ${this.token}` } : {};
    }

    private async request(
        method: 'GET' | 'POST' | 'DELETE',
        path: string,
        body?: unknown,
        opts: { tolerate404?: boolean } = {},
    ): Promise<unknown> {
        const init: RequestInit = {
            method,
            headers: {
                ...this.authHeaders,
                ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            },
            signal: AbortSignal.timeout(60_000),
        };
        if (body !== undefined) init.body = JSON.stringify(body);

        const res = await this.fetchImpl(`${this.baseUrl}${path}`, init);
        const text = await res.text();

        if (res.ok) {
            if (text.length === 0) return {};
            try {
                return JSON.parse(text);
            } catch {
                throw new SpectraApiError(res.status, text, `Non-JSON response from ${method} ${path}`);
            }
        }

        if (opts.tolerate404 && res.status === 404) return {};

        const parsedError = safeParseError(text);
        const msg = parsedError ?? `${method} ${path} failed (${res.status})`;
        throw new SpectraApiError(res.status, text, msg);
    }
}

function safeParseError(text: string): string | null {
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string') {
            return parsed.error;
        }
    } catch {
        /* fall through */
    }
    return null;
}
