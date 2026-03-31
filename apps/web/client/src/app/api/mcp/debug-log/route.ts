import { type NextRequest, NextResponse } from 'next/server';
import { appendFile } from 'fs/promises';

const LOG_FILE = '/tmp/mcp-apps-debug/client.log';

/**
 * Receives client-side MCP Apps debug log entries and writes them to a file.
 */
export async function POST(request: NextRequest) {
    try {
        const entry = await request.json();
        const line = JSON.stringify(entry) + '\n';
        await appendFile(LOG_FILE, line);
        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: 'Failed to write log' }, { status: 500 });
    }
}
