'use client';

import type { Branch, Project } from '@onlook/models';
import { usePostHog } from 'posthog-js/react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { EditorEngine } from './engine';

const EditorEngineContext = createContext<EditorEngine | null>(null);

export const useEditorEngine = () => {
    const ctx = useContext(EditorEngineContext);
    if (!ctx) throw new Error('useEditorEngine must be inside EditorEngineProvider');
    return ctx;
};

export const EditorEngineProvider = ({
    children,
    project,
    branches
}: {
    children: React.ReactNode,
    project: Project,
    branches: Branch[],
}) => {
    const posthog = usePostHog();
    const currentProjectId = useRef(project.id);
    const engineRef = useRef<EditorEngine | null>(null);
    const initializedProjectIdRef = useRef<string | null>(null);

    const [editorEngine, setEditorEngine] = useState(() => {
        const engine = new EditorEngine(project.id, posthog);
        void engine.branches.initBranches(branches);
        if (typeof window !== 'undefined') {
            void engine.branches.init();
            void engine.init();
            initializedProjectIdRef.current = project.id;
        }
        engine.screenshot.lastScreenshotAt = project.metadata?.previewImg?.updatedAt ?? null;
        engineRef.current = engine;
        return engine;
    });

    // Initialize the engine only after mount. Starting branch/session boot
    // work during render leaks browser-only provider setup into SSR.
    useEffect(() => {
        const initializeEngine = async () => {
            if (
                initializedProjectIdRef.current === project.id &&
                currentProjectId.current === project.id
            ) {
                return;
            }

            if (currentProjectId.current !== project.id) {
                // Clean up old engine with delay to avoid race conditions
                if (engineRef.current) {
                    setTimeout(() => engineRef.current?.clear(), 0);
                }

                // Create new engine for new project
                const newEngine = new EditorEngine(project.id, posthog);
                await newEngine.branches.initBranches(branches);
                await newEngine.branches.init();
                await newEngine.init();
                newEngine.screenshot.lastScreenshotAt = project.metadata?.previewImg?.updatedAt ?? null;

                engineRef.current = newEngine;
                setEditorEngine(newEngine);
                currentProjectId.current = project.id;
                initializedProjectIdRef.current = project.id;
                return;
            }

            const currentEngine = engineRef.current;
            if (!currentEngine) {
                return;
            }

            await currentEngine.branches.initBranches(branches);
            await currentEngine.branches.init();
            await currentEngine.init();
            currentEngine.screenshot.lastScreenshotAt = project.metadata?.previewImg?.updatedAt ?? null;
            initializedProjectIdRef.current = project.id;
        };

        void initializeEngine();
    }, [project.id]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            setTimeout(() => engineRef.current?.clear(), 0);
        };
    }, []);

    return (
        <EditorEngineContext.Provider value={editorEngine}>
            {children}
        </EditorEngineContext.Provider>
    );
};
