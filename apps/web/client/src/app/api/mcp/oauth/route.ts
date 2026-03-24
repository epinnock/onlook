import { type NextRequest, NextResponse } from 'next/server';

/**
 * MCP OAuth flow handler.
 *
 * GET /api/mcp/oauth?action=start&serverUrl=...&serverId=...&projectId=...
 *   → Discovers OAuth metadata, registers client, redirects to authorization endpoint
 *
 * GET /api/mcp/oauth?code=...&state=...
 *   → Exchanges authorization code for tokens, returns them to the opener window
 */
export async function GET(req: NextRequest) {
    const { searchParams } = req.nextUrl;
    const action = searchParams.get('action');

    if (action === 'start') {
        return handleStart(req);
    }

    // OAuth callback with authorization code
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    if (code && state) {
        return handleCallback(req, code, state);
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
}

async function handleStart(req: NextRequest) {
    const { searchParams } = req.nextUrl;
    const serverUrl = searchParams.get('serverUrl');
    const serverId = searchParams.get('serverId');
    const projectId = searchParams.get('projectId');

    if (!serverUrl || !serverId || !projectId) {
        return NextResponse.json({ error: 'Missing serverUrl, serverId, or projectId' }, { status: 400 });
    }

    try {
        // 1. Discover OAuth metadata
        const metadataUrl = new URL('/.well-known/oauth-authorization-server', serverUrl).toString();
        const metadataRes = await fetch(metadataUrl);
        if (!metadataRes.ok) {
            return NextResponse.json({ error: 'Failed to discover OAuth metadata' }, { status: 502 });
        }
        const metadata = await metadataRes.json();

        // 2. Register client (Dynamic Client Registration)
        const callbackUrl = new URL('/api/mcp/oauth', req.nextUrl.origin).toString();
        const registrationRes = await fetch(metadata.registration_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_name: 'Onlook IDE',
                redirect_uris: [callbackUrl],
                grant_types: ['authorization_code', 'refresh_token'],
                response_types: ['code'],
                token_endpoint_auth_method: 'none',
            }),
        });

        if (!registrationRes.ok) {
            const regError = await registrationRes.text();
            return NextResponse.json({ error: 'Client registration failed', detail: regError }, { status: 502 });
        }
        const clientInfo = await registrationRes.json();

        // 3. Generate PKCE code verifier and challenge
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = await generateCodeChallenge(codeVerifier);

        // 4. Build state (encodes serverId, projectId, and codeVerifier for the callback)
        const statePayload = JSON.stringify({
            serverId,
            projectId,
            serverUrl,
            codeVerifier,
            clientId: clientInfo.client_id,
            clientSecret: clientInfo.client_secret,
            tokenEndpoint: metadata.token_endpoint,
        });
        const stateEncoded = Buffer.from(statePayload).toString('base64url');

        // 5. Redirect to authorization endpoint
        const authUrl = new URL(metadata.authorization_endpoint);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', clientInfo.client_id);
        authUrl.searchParams.set('redirect_uri', callbackUrl);
        authUrl.searchParams.set('state', stateEncoded);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');

        return NextResponse.redirect(authUrl.toString());
    } catch (error) {
        console.error('MCP OAuth start error:', error);
        return NextResponse.json({ error: 'OAuth flow failed' }, { status: 500 });
    }
}

async function handleCallback(req: NextRequest, code: string, stateEncoded: string) {
    try {
        // Decode state
        const statePayload = JSON.parse(Buffer.from(stateEncoded, 'base64url').toString());
        const { serverId, projectId, serverUrl, codeVerifier, clientId, clientSecret, tokenEndpoint } = statePayload;

        // Exchange code for tokens
        const callbackUrl = new URL('/api/mcp/oauth', req.nextUrl.origin).toString();
        const tokenParams = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: callbackUrl,
            client_id: clientId,
            code_verifier: codeVerifier,
        });
        if (clientSecret) {
            tokenParams.set('client_secret', clientSecret);
        }

        const tokenRes = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tokenParams.toString(),
        });

        if (!tokenRes.ok) {
            const tokenError = await tokenRes.text();
            console.error('Token exchange failed:', tokenError);
            return new Response(renderResultPage(false, 'Token exchange failed'), {
                headers: { 'Content-Type': 'text/html' },
            });
        }

        const tokens = await tokenRes.json();

        // Return an HTML page that posts the tokens back to the opener window
        return new Response(
            renderResultPage(true, undefined, {
                serverId,
                projectId,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiresIn: tokens.expires_in,
            }),
            { headers: { 'Content-Type': 'text/html' } },
        );
    } catch (error) {
        console.error('MCP OAuth callback error:', error);
        return new Response(renderResultPage(false, 'OAuth callback failed'), {
            headers: { 'Content-Type': 'text/html' },
        });
    }
}

function renderResultPage(success: boolean, error?: string, data?: Record<string, unknown>): string {
    return `<!DOCTYPE html>
<html><head><title>MCP OAuth</title></head>
<body>
<script>
  if (window.opener) {
    window.opener.postMessage({
      type: 'mcp-oauth-result',
      success: ${success},
      ${error ? `error: ${JSON.stringify(error)},` : ''}
      ${data ? `data: ${JSON.stringify(data)},` : ''}
    }, window.location.origin);
    window.close();
  } else {
    document.body.innerText = ${success ? '"Connected! You can close this window."' : `"Error: " + ${JSON.stringify(error || 'Unknown error')}`};
  }
</script>
</body></html>`;
}

function generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Buffer.from(array).toString('base64url');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Buffer.from(new Uint8Array(digest)).toString('base64url');
}
