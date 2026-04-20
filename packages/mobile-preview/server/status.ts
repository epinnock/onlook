import type {
    MobilePreviewHttpStatusResponse,
    MobilePreviewWsStatusResponse,
} from './routes';

export interface MobilePreviewHttpStatusContext {
    readonly runtimeHash: string | null;
    readonly clients: number;
    readonly lanIp: string;
    readonly httpPort: number;
}

export interface MobilePreviewWsStatusContext extends MobilePreviewHttpStatusContext {
    readonly wsPort: number;
}

export function buildHttpStatus(
    context: MobilePreviewHttpStatusContext,
): MobilePreviewHttpStatusResponse {
    return {
        runtimeHash: context.runtimeHash,
        clients: context.clients,
        manifestUrl: context.runtimeHash
            ? `exp://${context.lanIp}:${context.httpPort}/manifest/${context.runtimeHash}`
            : null,
    };
}

export function createHttpStatusResponse(context: MobilePreviewHttpStatusContext): Response {
    return Response.json(buildHttpStatus(context));
}

export function buildWsStatus(context: MobilePreviewWsStatusContext): MobilePreviewWsStatusResponse {
    return {
        clients: context.clients,
        runtimeHash: context.runtimeHash,
        lanIp: context.lanIp,
        httpPort: context.httpPort,
        wsPort: context.wsPort,
    };
}

export function createWsStatusResponse(context: MobilePreviewWsStatusContext): Response {
    return Response.json(buildWsStatus(context));
}
