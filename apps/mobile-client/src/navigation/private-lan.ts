/**
 * Pure-helper module split out from AppRouter.tsx so the unit tests don't
 * pull react-native into the bun:test process (RN's `import typeof` Flow
 * syntax is not parseable by Bun's TS loader).
 *
 * Returns true when the host is in an RFC-1918 private address space
 * (10/8, 172.16/12, 192.168/16) or loopback (127/8, "localhost"). The
 * AppRouter URL-pipeline preflight skips its external-connectivity check
 * (`fetch('https://1.1.1.1/')`) for these because LAN-only setups
 * (Mac mini farm, on-set dev rig with no upstream internet) routinely
 * point the phone at a development server with no route to the public
 * internet, and Stage 0a is a false negative there.
 *
 * Public hosts (esm.sh, expo.dev, anything not RFC-1918) keep both stages
 * because a public manifest URL implies the phone needs internet to reach
 * it, so a Stage 0a failure there is a real diagnostic.
 *
 * IPv4 only today; the IPv6 loopback / link-local cases (::1, fe80::/10)
 * are not yet recognised. Add when an IPv6 LAN setup actually shows up.
 */
export function isPrivateLanHost(host: string): boolean {
    // Strip port if present
    const h = host.replace(/:\d+$/, '');
    if (h === 'localhost' || h === '127.0.0.1') return true;
    const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return false;
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    return false;
}
