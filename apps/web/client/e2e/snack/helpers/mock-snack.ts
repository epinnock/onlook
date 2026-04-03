export function createMockSnack(initialFiles?: Record<string, any>) {
    let files = initialFiles || {};
    let deps: Record<string, any> = {};
    const stateListeners: Array<(state: any) => void> = [];
    const logListeners: Array<(log: any) => void> = [];
    const errorListeners: Array<(err: any) => void> = [];

    return {
        getState: () => ({ files, dependencies: deps, online: true }),
        updateFiles: (updates: Record<string, any>) => {
            files = { ...files, ...updates };
            // Remove null entries
            for (const [k, v] of Object.entries(files)) {
                if (v === null) delete files[k];
            }
            stateListeners.forEach((cb) => cb({ files, dependencies: deps }));
        },
        updateDependencies: (newDeps: Record<string, any>) => {
            deps = { ...deps, ...newDeps };
        },
        setOnline: () => {},
        getUrlAsync: async () => 'exp://exp.host/@snack/test-123',
        saveAsync: async () => ({ id: 'test-snack-id' }),
        addStateListener: (cb: any) => {
            stateListeners.push(cb);
            return { remove: () => {} };
        },
        addLogListener: (cb: any) => {
            logListeners.push(cb);
            return { remove: () => {} };
        },
        addErrorListener: (cb: any) => {
            errorListeners.push(cb);
            return { remove: () => {} };
        },
        reloadConnectedClients: () => {},
        // Helper to simulate log from device
        _emitLog: (msg: string) => logListeners.forEach((cb) => cb({ message: msg })),
        _emitError: (msg: string) => errorListeners.forEach((cb) => cb({ message: msg })),
    };
}
