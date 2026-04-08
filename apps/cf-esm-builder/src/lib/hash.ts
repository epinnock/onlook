/**
 * Deterministic SHA256 of a canonicalised source tar.
 *
 * Hashing rules live in `plans/expo-browser-builder-protocol.md` §Hashing rules
 * and MUST match the editor-side `source-tar.ts` writer bit-for-bit.
 * Implemented in TH2.5.
 */

export async function sha256OfTar(tar: ArrayBuffer): Promise<string> {
    throw new Error('TODO: TH2.5');
}
