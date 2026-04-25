/**
 * Strip scheme / port / path from the `host` argument passed to shell.js's
 * `_tryConnectWebSocket(host, port)` so it always synthesizes a well-formed
 * `ws://<bareHost>:<port>` URL.
 *
 * Callers sometimes pass a full manifest URL (historical reason: the editor
 * used to push the entire relay manifest endpoint as `relayHost`). shell.js
 * has its own copy of this logic inline — keep both in sync.
 *
 * This helper is exported so the behaviour is unit-testable (task #82).
 */

export function stripWsHost(host: string): string {
    if (typeof host !== 'string') return host;
    try {
        if (/^\w+:\/\//.test(host)) {
            const afterScheme = host.replace(/^\w+:\/\//, '');
            const beforePath = afterScheme.split('/')[0] ?? '';
            const beforePort = beforePath.split(':')[0] ?? '';
            return beforePort;
        }
    } catch {
        // Fall through to the raw input.
    }
    return host;
}
