// Global test setup file that mocks common dependencies
// This file should be preloaded before all tests to ensure mocks are set up properly
import { mock } from 'bun:test';

console.log('🔧 Setting up test mocks...');

const DEFAULT_PLAYWRIGHT_PORT = 3000;

const parsePort = (envVarName: 'PLAYWRIGHT_PORT' | 'PORT') => {
    const rawPort = process.env[envVarName]?.trim();
    if (!rawPort) {
        return null;
    }

    const port = Number.parseInt(rawPort, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`${envVarName} must be a valid port. Received "${rawPort}".`);
    }

    return port;
};

const resolveLocalTestUrl = () => {
    const explicitBaseURL = process.env.PLAYWRIGHT_BASE_URL?.trim();
    if (explicitBaseURL) {
        return new URL(explicitBaseURL).toString();
    }

    const port =
        parsePort('PLAYWRIGHT_PORT') ??
        parsePort('PORT') ??
        DEFAULT_PLAYWRIGHT_PORT;

    return `http://localhost:${port}`;
};

const mockSandboxUrl = resolveLocalTestUrl();

// Create comprehensive mock functions
const createMockMutation = (returnValue?: any) => ({
    mutate: mock(async (params?: any) => {
        // console.log('Mock TRPC mutation called with:', params);
        return returnValue || true;
    })
});

const createMockQuery = (returnValue?: any) => ({
    query: mock(async (params?: any) => {
        // console.log('Mock TRPC query called with:', params);
        return returnValue || null;
    })
});

// Mock TRPC client to prevent network calls during tests - must be first
mock.module('@/trpc/client', () => ({
    api: {
        branch: {
            fork: createMockMutation({
                branch: {
                    id: 'mock-branch-id',
                    name: 'Mock Branch',
                    projectId: 'mock-project-id',
                    description: 'Mock forked branch',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    isDefault: false,
                    git: null,
                    sandbox: { id: 'mock-sandbox-id' }
                },
                frames: []
            }),
            update: createMockMutation(true),
            delete: createMockMutation(true),
            list: createMockQuery([]),
            get: createMockQuery({
                id: 'mock-branch-id',
                name: 'Mock Branch',
                projectId: 'mock-project',
                description: 'Mock branch',
                createdAt: new Date(),
                updatedAt: new Date(),
                isDefault: false,
                git: null,
                sandbox: { id: 'mock-sandbox-id' }
            })
        },
        project: {
            get: createMockQuery({
                id: 'mock-project-id',
                name: 'Mock Project',
                createdAt: new Date(),
                updatedAt: new Date()
            })
        },
        sandbox: {
            init: createMockMutation({
                id: 'mock-sandbox-id',
                status: 'ready'
            }),
            status: createMockQuery({ status: 'ready' }),
            start: createMockMutation({
                id: 'mock-sandbox-id',
                status: 'ready',
                url: mockSandboxUrl
            }),
            stop: createMockMutation(true),
            restart: createMockMutation({
                id: 'mock-sandbox-id',
                status: 'ready',
                url: mockSandboxUrl
            }),
            hibernate: createMockMutation(true)
        }
    }
}));

// Also mock the TRPC React Query hooks
mock.module('@trpc/react-query', () => ({
    createTRPCReact: mock(() => ({
        useQuery: mock(() => ({ data: null, isLoading: false, error: null })),
        useMutation: mock(() => ({ 
            mutate: mock(() => {}), 
            mutateAsync: mock(async () => true),
            isLoading: false, 
            error: null 
        }))
    }))
}));

// Mock toast to avoid UI dependencies
mock.module('@onlook/ui/sonner', () => ({
    toast: {
        success: mock(() => {}),
        error: mock(() => {}),
        info: mock(() => {}),
        warning: mock(() => {}),
        promise: mock(() => {})
    }
}));

// Mock MobX to avoid strict mode issues in tests
mock.module('mobx', () => ({
    makeAutoObservable: mock(() => {}),
    reaction: mock(() => () => {}),
    runInAction: mock((fn: any) => fn()),
    action: mock((fn: any) => fn),
    observable: mock((obj: any) => obj),
    computed: mock((fn: any) => ({ get: fn }))
}));

// Mock localforage to avoid browser storage dependencies
mock.module('localforage', () => ({
    getItem: mock(async () => null),
    setItem: mock(async () => undefined),
    removeItem: mock(async () => undefined),
    clear: mock(async () => undefined)
}));
