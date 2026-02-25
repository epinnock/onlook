import { useEditorEngine } from '@/components/store/editor';
import { ProjectType } from '@onlook/constants';
import { useEffect, useState } from 'react';

export function useActiveProjectType(): ProjectType {
    const editorEngine = useEditorEngine();
    const [projectType, setProjectType] = useState<ProjectType>(ProjectType.NEXTJS);

    useEffect(() => {
        let isActive = true;
        editorEngine.activeSandbox
            .getProjectType()
            .then((type) => {
                if (isActive) {
                    setProjectType(type);
                }
            })
            .catch(() => {
                if (isActive) {
                    setProjectType(ProjectType.NEXTJS);
                }
            });

        return () => {
            isActive = false;
        };
    }, [editorEngine, editorEngine.branches.activeBranch.id]);

    return projectType;
}
