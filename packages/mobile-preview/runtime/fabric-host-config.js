/**
 * fabric-host-config.js — Maps react-reconciler to nativeFabricUIManager.
 *
 * The public module stays stable for runtime imports; implementation details
 * live under runtime/host to keep the reconciler surface easier to change.
 */

export { createHostConfig } from './host/create-host-config.js';
