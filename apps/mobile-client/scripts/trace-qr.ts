/**
 * trace-qr.ts — diagnostic runner for the qrToMount pipeline.
 *
 * Invokes parseOnlookDeepLink → fetchManifest → fetchBundle against a
 * user-supplied URL. Prints each stage's result so we can see where the
 * pipeline fails without needing a device round-trip.
 *
 * Mount stage is omitted — runApplication requires Hermes + the JSI
 * binding; this script runs under bun which doesn't have those, so we
 * stop after bundle fetch and just print the first 400 chars of the
 * bundle for sanity.
 *
 * Usage:
 *   bun run scripts/trace-qr.ts 'exp://host:port/manifest/<hash>'
 *   bun run scripts/trace-qr.ts 'onlook://launch?session=...&relay=...'
 */
import { parseOnlookDeepLink } from '../src/deepLink/parse';
import { fetchBundle } from '../src/relay/bundleFetcher';
import { fetchManifest } from '../src/relay/manifestFetcher';

async function main() {
    const url = process.argv[2];
    if (!url) {
        console.error('Usage: bun run scripts/trace-qr.ts <url>');
        process.exit(2);
    }

    console.log(`[trace] input: ${url}`);
    console.log(`[trace] stage=parse`);
    const parsed = parseOnlookDeepLink(url);
    if (!parsed || !parsed.sessionId || !parsed.relay) {
        console.error(`[trace] parse FAILED — parser returned: ${JSON.stringify(parsed)}`);
        process.exit(1);
    }
    console.log(`[trace] parse ok:`, parsed);

    console.log(`[trace] stage=manifest GET ${parsed.relay}`);
    const manifestResult = await fetchManifest(parsed.relay);
    if (!manifestResult.ok) {
        console.error(`[trace] manifest FAILED: ${manifestResult.error}`);
        process.exit(1);
    }
    console.log(`[trace] manifest ok:`);
    console.log(
        JSON.stringify(manifestResult.manifest, null, 2).slice(0, 1500),
    );

    const bundleUrl = manifestResult.manifest.launchAsset.url;
    console.log(`[trace] stage=bundle GET ${bundleUrl}`);
    const bundleResult = await fetchBundle(bundleUrl);
    if (!bundleResult.ok) {
        console.error(`[trace] bundle FAILED: ${bundleResult.error}`);
        process.exit(1);
    }
    console.log(`[trace] bundle ok: ${bundleResult.source.length} bytes`);
    console.log(`[trace] bundle head (first 400 chars):`);
    console.log(bundleResult.source.slice(0, 400));
    console.log(`[trace] bundle tail (last 400 chars):`);
    console.log(bundleResult.source.slice(-400));

    // Quick React-version sniff for the known dual-React issue
    const versionMatches = bundleResult.source.match(/\.version=["']19\.[0-9]+\.[0-9]+["']/g);
    console.log(`[trace] react-version literals in bundle:`, versionMatches ?? 'none');

    console.log(`[trace] DONE — pipeline would call runApplication() next`);
}

main().catch((err) => {
    console.error('[trace] unexpected error:', err);
    process.exit(1);
});
