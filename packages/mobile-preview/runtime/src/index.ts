/**
 * `@onlook/mobile-preview/runtime` — typed entry point for the JS-side
 * runtime helpers consumed by the native mobile-client and by
 * mobile-preview test harnesses.
 *
 * The legacy CommonJS shells (`shell.js`, `runtime.js`, `entry.js`,
 * `fabric-host-config.js`) remain one directory up under
 * `packages/mobile-preview/runtime/`; they are served verbatim to Expo Go
 * by the mobile-preview server and must not import from this TypeScript
 * tree.
 */

export {
    __testResetOnlookRuntime,
    ABI_VERSION,
    installOnlookRuntimeJs,
    type InstallOnlookRuntimeJsOptions,
    type OnlookRuntimeApi,
    type OnlookRuntimeError,
    type AbiVersion,
} from './onlook-runtime-js.ts';

export {
    startRelayEventPoll,
    type HttpGetFn,
    type HttpGetResult,
    type RelayEvent,
    type RelayEventPollHandle,
    type RelayEventPollOptions,
    type RelayEventsResponse,
} from './relayEventPoll.ts';

export { stripWsHost } from './stripWsHost.ts';
