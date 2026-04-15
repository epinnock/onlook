export async function pushMobilePreviewUpdate(args: {
    serverBaseUrl: string;
    code: string;
}): Promise<void> {
    const baseUrl = args.serverBaseUrl.trim().replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/push`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            type: 'eval',
            code: args.code,
        }),
    });

    if (!res.ok) {
        throw new Error(`mobile-preview /push returned ${res.status}`);
    }
}
