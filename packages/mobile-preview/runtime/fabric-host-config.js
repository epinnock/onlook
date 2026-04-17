/**
 * fabric-host-config.js — Maps react-reconciler to nativeFabricUIManager.
 *
 * The public module stays stable for runtime imports; implementation details
 * live under runtime/host to keep the reconciler surface easier to change.
 */

import { createHostConfig as createBaseHostConfig } from './host/create-host-config.js';
import { registerFabricEventHandler } from './host/events.js';

export function createHostConfig(fab, rootTag) {
  registerFabricEventHandler(fab);
  return createBaseHostConfig(fab, rootTag);
}
