/**
 * Scry Sandbox Worker
 *
 * Thin HTTP proxy over the Cloudflare Sandbox SDK.
 * The Next.js app calls these endpoints; the Worker talks to the Sandbox DO.
 *
 * Endpoints:
 *   POST /sandbox/create   { id?, image? }          → { sandboxId }
 *   POST /sandbox/exec     { sandboxId, command }    → { stdout, stderr, exitCode, success }
 *   POST /sandbox/file/read  { sandboxId, path }     → { content }
 *   POST /sandbox/file/write { sandboxId, path, content } → { ok }
 *   POST /sandbox/file/list  { sandboxId, path }     → { entries }
 *   POST /sandbox/process/start { sandboxId, command } → { processId }
 *   POST /sandbox/process/kill  { sandboxId, processId } → { ok }
 *   POST /sandbox/preview-url { sandboxId, port }     → { previewUrl, workerPreviewUrl }
 *   GET  /preview/:sandboxId/*                         → proxy to container's dev server
 *   GET  /sandbox/preview/:sandboxId/:port            → proxy to sandbox preview (SDK)
 *   GET  /health                                      → { status: "ok" }
 */

import { getSandbox, proxyToSandbox, type Sandbox } from '@cloudflare/sandbox';

export { Sandbox } from '@cloudflare/sandbox';

type Env = {
	SANDBOX: DurableObjectNamespace<Sandbox>;
};

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		// Let the SDK handle preview URL proxying
		const proxyResponse = await proxyToSandbox(request, env);
		if (proxyResponse) return proxyResponse;

		const url = new URL(request.url);
		const path = url.pathname;

		// CORS headers for local dev
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		};

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		try {
			// Health check
			if (path === '/health') {
				return json({ status: 'ok', timestamp: new Date().toISOString() }, corsHeaders);
			}

			// Preview proxy: GET /preview/:sandboxId/* → fetch HTML from container's dev server via exec
			if (request.method === 'GET' && path.startsWith('/preview/')) {
				const parts = path.split('/');
				const previewSandboxId = parts[2];
				const proxyPath = '/' + parts.slice(3).join('/');

				if (!previewSandboxId) {
					return json({ error: 'sandboxId required in preview URL' }, corsHeaders, 400);
				}

				try {
					const sandbox = getSandbox(env.SANDBOX, previewSandboxId);

					// Fetch via exec curl inside the container (works in local dev + production)
					const result = await sandbox.exec(
						`curl -s -w "\\n---HTTP_STATUS:%{http_code}---" http://localhost:3001${proxyPath}${url.search} 2>/dev/null`
					);
					const output = result.stdout;
					const statusMatch = output.match(/---HTTP_STATUS:(\d+)---$/);
					const httpStatus = statusMatch ? parseInt(statusMatch[1]) : 200;
					const body = output.replace(/\n---HTTP_STATUS:\d+---$/, '');

					// Detect content type from path
					const ext = proxyPath.split('.').pop()?.toLowerCase();
					const contentTypes: Record<string, string> = {
						'js': 'application/javascript',
						'css': 'text/css',
						'json': 'application/json',
						'png': 'image/png',
						'svg': 'image/svg+xml',
						'ico': 'image/x-icon',
					};
					const contentType = contentTypes[ext || ''] || 'text/html; charset=utf-8';

					return new Response(body, {
						status: httpStatus,
						headers: { 'Content-Type': contentType, ...corsHeaders },
					});
				} catch (err) {
					return json({ error: `Preview proxy error: ${err instanceof Error ? err.message : err}` }, corsHeaders, 502);
				}
			}

			// All sandbox routes require POST with JSON body
			if (request.method !== 'POST' || !path.startsWith('/sandbox/')) {
				return json({ error: 'Not found' }, corsHeaders, 404);
			}

			const body = (await request.json()) as Record<string, string>;

			// --- Create sandbox ---
			if (path === '/sandbox/create') {
				const sandboxId = body.id || `sandbox-${Date.now()}`;
				const sandbox = getSandbox(env.SANDBOX, sandboxId);

				// Ping to ensure sandbox is alive
				const result = await sandbox.exec('echo "ready"');
				return json(
					{
						sandboxId,
						ready: result.success,
						stdout: result.stdout.trim(),
					},
					corsHeaders,
				);
			}

			// All other routes need sandboxId
			const { sandboxId } = body;
			if (!sandboxId) {
				return json({ error: 'sandboxId is required' }, corsHeaders, 400);
			}

			const sandbox = getSandbox(env.SANDBOX, sandboxId);

			// --- Execute command ---
			if (path === '/sandbox/exec') {
				const { command } = body;
				if (!command) return json({ error: 'command is required' }, corsHeaders, 400);

				const result = await sandbox.exec(command);
				return json(
					{
						stdout: result.stdout,
						stderr: result.stderr,
						exitCode: result.exitCode,
						success: result.success,
					},
					corsHeaders,
				);
			}

			// --- File read (via exec cat) ---
			if (path === '/sandbox/file/read') {
				const { path: filePath } = body;
				if (!filePath) return json({ error: 'path is required' }, corsHeaders, 400);

				const result = await sandbox.exec(`cat ${JSON.stringify(filePath)}`);
				if (!result.success) return json({ error: result.stderr }, corsHeaders, 500);
				return json({ content: result.stdout }, corsHeaders);
			}

			// --- File write (via exec tee) ---
			if (path === '/sandbox/file/write') {
				const { path: filePath, content } = body;
				if (!filePath) return json({ error: 'path is required' }, corsHeaders, 400);

				const escaped = (content || '').replace(/'/g, "'\\''");
				const result = await sandbox.exec(`mkdir -p "$(dirname ${JSON.stringify(filePath)})" && printf '%s' '${escaped}' > ${JSON.stringify(filePath)}`);
				if (!result.success) return json({ error: result.stderr }, corsHeaders, 500);
				return json({ ok: true }, corsHeaders);
			}

			// --- File list (via exec ls) ---
			if (path === '/sandbox/file/list') {
				const { path: dirPath } = body;
				const target = dirPath || '/workspace';
				const result = await sandbox.exec(`ls -1F ${JSON.stringify(target)} 2>/dev/null || echo ""`);
				const entries = result.stdout.trim().split('\n').filter(Boolean).map(entry => ({
					name: entry.replace(/[/@*]$/, ''),
					type: entry.endsWith('/') ? 'directory' as const : 'file' as const,
				}));
				return json({ entries }, corsHeaders);
			}

			// --- File mkdir ---
			if (path === '/sandbox/file/mkdir') {
				const { path: dirPath } = body;
				if (!dirPath) return json({ error: 'path is required' }, corsHeaders, 400);

				await sandbox.exec(`mkdir -p ${dirPath}`);
				return json({ ok: true }, corsHeaders);
			}

			// --- Process start ---
			if (path === '/sandbox/process/start') {
				const { command } = body;
				if (!command) return json({ error: 'command is required' }, corsHeaders, 400);

				const process = await sandbox.startProcess(command);
				return json({ processId: process.id, command }, corsHeaders);
			}

			// --- Process kill ---
			if (path === '/sandbox/process/kill') {
				const { processId } = body;
				if (!processId) return json({ error: 'processId is required' }, corsHeaders, 400);

				await sandbox.killProcess(processId);
				return json({ ok: true }, corsHeaders);
			}

			// --- Get preview URL ---
			if (path === '/sandbox/preview-url') {
				const { port } = body;
				let previewUrl: string | undefined;
				try {
					previewUrl = await sandbox.getPreviewUrl(Number(port) || 3001);
				} catch { /* not available in local dev */ }
				return json({
					previewUrl: previewUrl || null,
					workerPreviewUrl: `${url.origin}/preview/${sandboxId}`,
				}, corsHeaders);
			}

			return json({ error: `Unknown route: ${path}` }, corsHeaders, 404);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`Error on ${path}:`, message);
			return json({ error: message }, corsHeaders, 500);
		}
	},
};

function json(data: unknown, extraHeaders: Record<string, string> = {}, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json', ...extraHeaders },
	});
}
