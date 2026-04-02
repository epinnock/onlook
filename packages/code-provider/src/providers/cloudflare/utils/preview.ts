export interface SandboxPreviewAPI {
    getPreviewUrl(port: number): string;
    status(): Promise<{ state: string }>;
}

export function getPreviewUrl(sandbox: SandboxPreviewAPI, port: number): string {
    return sandbox.getPreviewUrl(port);
}

export function buildPreviewUrl(sandboxId: string, port: number): string {
    return `https://${sandboxId}-${port}.containers.dev`;
}

export async function isPreviewReady(url: string): Promise<boolean> {
    try {
        const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
        return res.ok;
    } catch {
        return false;
    }
}

export async function waitForPreview(url: string, timeoutMs = 60000): Promise<boolean> {
    const start = Date.now();
    let delay = 1000;
    while (Date.now() - start < timeoutMs) {
        if (await isPreviewReady(url)) return true;
        await new Promise(r => setTimeout(r, delay));
        delay = Math.min(delay * 2, 8000);
    }
    return false;
}
