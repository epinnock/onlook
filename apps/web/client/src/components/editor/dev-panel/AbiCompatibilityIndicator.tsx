'use client';

/**
 * AbiCompatibilityIndicator — editor-side dev-panel status surface for the
 * Phase 11b AbiHello handshake. Mirrors `RelayWsClient.getLastAbiCompatibility`
 * (aed09752) so operators can eyeball whether `pushOverlayV1` will succeed
 * or fail-closed BEFORE attempting an edit.
 *
 * States:
 *   - `'unknown'`           — no phone hello received yet on the current
 *                             socket. `pushOverlayV1` fails-closed in this
 *                             state. Shown as amber "WAITING" badge.
 *   - `'ok'`                — phone hello arrived and `checkAbiCompatibility`
 *                             passed. Shown as emerald "OK" badge.
 *   - `OnlookRuntimeError`  — phone hello arrived but reports an
 *                             incompatible ABI / capabilities. Shown as
 *                             red "MISMATCH" badge with `kind: message`
 *                             reason line.
 *
 * Composition: rendered alongside the existing console/network/overlayAck
 * tabs in the dev panel — a small indicator in the panel header rather
 * than a full tab. Parent wiring is the dev-panel layout owner's call;
 * this component ships pure.
 *
 * Optional `phoneHello` prop surfaces the phone's reported capabilities
 * (rnVersion / expoSdk / platform / aliases) on hover for debugging the
 * handshake — particularly useful when the gate fail-closes and the
 * operator wants to know which binary the phone is running.
 */
import type { AbiHelloMessage, OnlookRuntimeError } from '@onlook/mobile-client-protocol';
import { cn } from '@onlook/ui/utils';

/**
 * Same shape as `RelayWsCompatibility` in `relay-ws-client.ts` but
 * re-declared here so the component package doesn't pull a service-layer
 * import for one type. Keep in sync — both narrow to the same union.
 */
export type AbiCompatibilityState = 'unknown' | 'ok' | OnlookRuntimeError;

export interface AbiCompatibilityIndicatorProps {
    state: AbiCompatibilityState;
    /**
     * The phone's last AbiHello, if any. Surfaced via the badge's `title`
     * attribute for an at-a-glance hover summary of the connected
     * binary's capabilities. Pass `null` when the handshake has not
     * completed (state === 'unknown').
     */
    phoneHello?: AbiHelloMessage | null;
    className?: string;
}

interface BadgeStyle {
    label: string;
    badgeCls: string;
    reason?: string;
}

function styleFor(state: AbiCompatibilityState): BadgeStyle {
    if (state === 'unknown') {
        return {
            label: 'WAITING',
            badgeCls: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        };
    }
    if (state === 'ok') {
        return {
            label: 'OK',
            badgeCls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        };
    }
    return {
        label: 'MISMATCH',
        badgeCls: 'bg-red-500/25 text-red-300 border-red-500/40',
        reason: `${state.kind}: ${state.message}`,
    };
}

function formatHoverTitle(
    state: AbiCompatibilityState,
    hello: AbiHelloMessage | null | undefined,
): string {
    if (state === 'unknown') {
        return 'AbiHello handshake has not completed — pushOverlayV1 will fail-closed until the phone connects + sends its hello.';
    }
    if (state === 'ok') {
        if (!hello) return 'AbiHello handshake completed. Push gate is open.';
        const r = hello.runtime;
        return [
            'AbiHello handshake completed. Push gate is open.',
            `phone: ${r.platform} · RN ${r.rnVersion} · Expo SDK ${r.expoSdk}`,
            `aliases: ${r.aliases.length}`,
        ].join('\n');
    }
    // Mismatch path — surface the error's optional context fields when
    // present so operators get the same debug detail in the hover that
    // ends up in PostHog. `specifier` arrives on `unknown-specifier`
    // kinds (the bare import that the runtime couldn't resolve);
    // `assetId` arrives on `asset-missing` / `asset-load-failed` kinds
    // (the manifest entry that wasn't found). Stack is intentionally
    // omitted — a 100-line stack would overflow the title; the dev
    // panel's error tabs are the right place to inspect it.
    const lines = [
        `Phone abi reports incompatibility: ${state.kind}: ${state.message}`,
    ];
    if (state.specifier) {
        lines.push(`specifier: ${state.specifier}`);
    }
    if (state.assetId) {
        lines.push(`assetId: ${state.assetId}`);
    }
    if (state.source) {
        lines.push(
            `at ${state.source.fileName}:${state.source.lineNumber}:${state.source.columnNumber}`,
        );
    }
    lines.push(
        `Fix: ${
            state.kind === 'abi-mismatch'
                ? 'rebuild the phone binary against the matching ABI'
                : state.kind === 'unknown-specifier'
                  ? 'add the specifier to the base bundle alias map and rebuild'
                  : 'see runtime error message'
        }.`,
    );
    return lines.join('\n');
}

/**
 * Render a single-row indicator with a label + status badge and an
 * optional reason line for mismatch state. Sized to fit in the dev-panel
 * header next to the tab strip.
 */
export function AbiCompatibilityIndicator({
    state,
    phoneHello,
    className,
}: AbiCompatibilityIndicatorProps) {
    const style = styleFor(state);
    return (
        <div
            data-testid="abi-compatibility-indicator"
            data-state={typeof state === 'string' ? state : 'mismatch'}
            className={cn(
                'flex items-center gap-2 px-2 py-1 font-mono text-[10px] text-neutral-400',
                className,
            )}
            title={formatHoverTitle(state, phoneHello)}
        >
            <span className="shrink-0 tracking-wide uppercase text-neutral-500">
                ABI
            </span>
            <span
                data-testid="abi-compatibility-badge"
                data-state={typeof state === 'string' ? state : 'mismatch'}
                className={cn(
                    'inline-flex h-4 shrink-0 items-center rounded-sm border px-1.5 text-[10px] font-semibold tracking-wide uppercase',
                    style.badgeCls,
                )}
            >
                {style.label}
            </span>
            {style.reason ? (
                <span
                    data-testid="abi-compatibility-reason"
                    className="truncate text-red-300"
                >
                    {style.reason}
                </span>
            ) : null}
        </div>
    );
}
