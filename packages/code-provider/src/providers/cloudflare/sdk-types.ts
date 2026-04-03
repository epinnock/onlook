/**
 * Local type definitions mirroring the @cloudflare/sandbox SDK interfaces.
 *
 * The real SDK (`@cloudflare/sandbox`) depends on `cloudflare:workers`, a
 * Workers-only runtime module that cannot be bundled by Next.js / Turbopack.
 * These local types let the provider compile in any environment.  At runtime
 * the provider receives an `ISandbox` stub injected from a Cloudflare Worker.
 *
 * When the SDK types change, update this file to match.
 */

export interface ExecResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    success: boolean;
}

export interface ProcessInfo {
    id: string;
    command: string;
}

export interface FileWatchSSEEvent {
    type: 'event' | 'heartbeat';
    eventType: string;
    path: string;
}

/**
 * Minimal subset of the Cloudflare Sandbox Durable Object interface
 * used by CloudflareSandboxProvider.
 */
export interface ISandbox {
    exec(command: string): Promise<ExecResult>;
    startProcess(command: string): Promise<ProcessInfo>;
    killProcess(processId: string): Promise<void>;
    getProcess(name: string): Promise<ProcessInfo | null>;
    streamProcessLogs(processId: string): Promise<ReadableStream<Uint8Array>>;

    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    ls(path: string): Promise<Array<{ name: string; type: 'file' | 'directory' }>>;
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;

    watch(
        path: string,
        options?: { recursive?: boolean; exclude?: string[] },
    ): Promise<ReadableStream<Uint8Array>>;

    createSession(opts: { id: string }): Promise<void>;
}

/**
 * Lightweight SSE stream parser, replacing the SDK's `parseSSEStream`.
 * Yields parsed events from a ReadableStream of SSE data.
 */
export async function* parseSSEStream<T extends { type: string }>(
    stream: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
): AsyncGenerator<T> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            if (signal?.aborted) break;
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            let eventType = '';
            let data = '';

            for (const line of lines) {
                if (line.startsWith('event:')) {
                    eventType = line.slice(6).trim();
                } else if (line.startsWith('data:')) {
                    data = line.slice(5).trim();
                } else if (line === '') {
                    if (data) {
                        try {
                            const parsed = JSON.parse(data) as T;
                            yield parsed;
                        } catch {
                            // If data isn't JSON, yield a synthetic event
                            yield { type: 'event', eventType, path: data } as unknown as T;
                        }
                        eventType = '';
                        data = '';
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}
