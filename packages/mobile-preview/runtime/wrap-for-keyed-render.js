/**
 * wrap-for-keyed-render.js
 *
 * Fabric on Expo Go SDK 54 de-dupes a commit when the root child's reactTag
 * is unchanged — React reuses the root host instance across renders and
 * `cloneNodeWithNewProps` preserves the tag, so subsequent `completeRoot`
 * calls become no-ops and the screen never updates.
 *
 * `wrapForKeyedRender` wraps every render in a Fragment and injects a
 * monotonic key on the child, which forces React to unmount the existing
 * root and mount a fresh host instance on every push. The new instance gets
 * a new reactTag, breaking the Fabric dedupe. If the caller already set a
 * key the element passes through unchanged.
 *
 * Kept in its own CommonJS module so the pure logic can be unit-tested
 * without spinning up the reconciler (importing runtime.js in a test eagerly
 * builds a reconciler and calls globalThis._log).
 */

function wrapForKeyedRender(ReactApi, element, seq) {
  const keyed =
    element && typeof element === 'object' && element.key == null
      ? ReactApi.cloneElement(element, { key: '__onlook_render_' + seq })
      : element;
  return ReactApi.createElement(ReactApi.Fragment, null, keyed);
}

module.exports = { wrapForKeyedRender };
