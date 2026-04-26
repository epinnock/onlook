import { createCallerFactory, createTRPCRouter } from '~/server/api/trpc';
import {
    chatRouter,
    domainRouter,
    frameRouter,
    githubRouter,
    imageRouter,
    invitationRouter,
    memberRouter,
    projectRouter,
    publishRouter,
    sandboxRouter,
    settingsRouter,
    subscriptionRouter,
    usageRouter,
    userCanvasRouter,
    userRouter,
    utilsRouter,
} from './routers';
import { mobileInspectorRouter } from './routers/mobile-inspector';
import { branchRouter } from './routers/project/branch';
import { cfSandboxRouter } from './routers/project/cf-sandbox';

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
    sandbox: sandboxRouter,
    cfSandbox: cfSandboxRouter,
    user: userRouter,
    invitation: invitationRouter,
    project: projectRouter,
    branch: branchRouter,
    settings: settingsRouter,
    chat: chatRouter,
    frame: frameRouter,
    userCanvas: userCanvasRouter,
    utils: utilsRouter,
    member: memberRouter,
    domain: domainRouter,
    github: githubRouter,
    subscription: subscriptionRouter,
    usage: usageRouter,
    publish: publishRouter,
    mobileInspector: mobileInspectorRouter,
    // Audit-pattern catch (2026-04-25): `imageRouter` (compress
    // procedure backed by sharp via `@onlook/image-server`) was
    // barrel-exported from `routers/index.ts` but never registered
    // here, so `trpc.image.compress` was unreachable on the client.
    // Registering closes the half-wired state without changing
    // existing call-sites (no production caller exists today; the
    // procedure is now reachable for future consumers).
    image: imageRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter);
