/**
 * Flow utilities — high-level user-action pipelines composed from the
 * deepLink, relay, and storage primitives.
 *
 * Task: MC3.21
 */

export { qrToMount } from './qrToMount';
export type { QrMountResult, QrMountStage } from './qrToMount';

export { wireInspectorFlow } from './inspectorFlow';
export type { InspectorFlowHandle } from './inspectorFlow';
