/**
 * Task MCG.7 coexistence guard — prove `App.tsx` mounts `<AppRouter />` and
 * `<OverlayHost />` as siblings in its root fragment.
 *
 * The overlay pipeline's core architectural choice (documented in
 * `plans/adr/overlay-host-architecture.md`) is to render `OverlayHost` as a
 * sibling of the navigator rather than driving it through a second
 * `AppRegistry.runApplication` surface or a dedicated native host — because
 * both silently no-op on bridgeless+new-arch. If a future refactor splits
 * the two or nests `OverlayHost` inside a screen-specific tree, every
 * AppRouter screen except the one containing OverlayHost would silently lose
 * overlay rendering.
 *
 * Driving this with a real React renderer is infeasible here: mobile-client
 * uses neither `react-test-renderer` nor `react-dom`, and the isolated-test
 * runner skips `.tsx` files. Unit tests for the subscription contract
 * (`overlay/__tests__/OverlayHost.test.ts`), the render-frame constants
 * (same file), the mount → renderApp subscriber chain
 * (`overlay/__tests__/fakeRuntime.integration.test.ts`), and the error
 * boundary (`overlay/__tests__/OverlayErrorBoundary.test.ts`) already cover
 * every behavioural seam. This file layers in a structural guard on top:
 * regex assertions against `App.tsx`'s source text. If the composition ever
 * changes, the test fails with a precise message instead of silently
 * shipping an overlay path that works in isolation but never mounts on the
 * phone.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

const APP_TSX_SOURCE = readFileSync(
    join(import.meta.dir, '..', 'App.tsx'),
    'utf8',
);

describe('App.tsx composition (MCG.7)', () => {
    test('imports both AppRouter and OverlayHost', () => {
        expect(APP_TSX_SOURCE).toMatch(/from ['"]\.\/navigation['"]/);
        expect(APP_TSX_SOURCE).toMatch(/\bAppRouter\b/);
        expect(APP_TSX_SOURCE).toMatch(/from ['"]\.\/overlay\/OverlayHost['"]/);
        expect(APP_TSX_SOURCE).toMatch(/\bOverlayHost\b/);
    });

    test('renders OverlayHost as an immediate sibling of AppRouter (no nesting)', () => {
        // Strip whitespace so the matcher is resilient to formatting drift.
        const compact = APP_TSX_SOURCE.replace(/\s+/g, ' ');
        // The architectural invariant is "AppRouter precedes OverlayHost
        // as siblings, not nested" — required so overlays span every
        // screen in the navigator. Acceptable shapes include both the
        // bare-fragment form and any transparent wrapper (e.g.
        // `<DevMenuTrigger>` / `<View>`) provided AppRouter is the
        // immediate previous sibling of OverlayHost in JSX order:
        //   <><AppRouter /><OverlayHost /></>
        //   <DevMenuTrigger><AppRouter /><OverlayHost /></DevMenuTrigger>
        //   <View><AppRouter /><OverlayHost /></View>
        // The matcher requires AppRouter immediately followed by
        // OverlayHost with only whitespace + JSX comments between.
        const siblingPattern =
            /<AppRouter\s*\/>(?:\s|\{\/\*[^*]*\*\/\})*<OverlayHost\s*\/>/;
        expect(compact).toMatch(siblingPattern);
    });

    test('OverlayHost is NOT nested inside AppRouter (AppRouter must be self-closing)', () => {
        // Guard against a refactor that puts <OverlayHost /> INSIDE <AppRouter>'s
        // children (<AppRouter><OverlayHost /></AppRouter>) — which would scope
        // the overlay to a single screen instead of spanning the whole app.
        // The simplest structural check: AppRouter must be used as a
        // self-closing tag <AppRouter /> (no children), so nesting is
        // impossible by construction.
        const compact = APP_TSX_SOURCE.replace(/\s+/g, ' ');
        // Self-closing form IS required
        expect(compact).toMatch(/<AppRouter\s*\/>/);
        // Opening-tag form (non-self-closing) is forbidden
        expect(compact).not.toMatch(/<AppRouter(?:\s+[^/>]*)?>/);
    });

    test('OverlayHost is rendered as a JSX element, not imported and thrown away', () => {
        // Regression guard for an import-without-use dead-code path.
        expect(APP_TSX_SOURCE).toMatch(/<OverlayHost\s*\/>/);
    });
});
