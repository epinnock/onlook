import { useEditorEngine } from '@/components/store/editor';
import { isUnsupportedNativewindStyleValue, ProjectType } from '@onlook/constants';
import { toast } from '@onlook/ui/sonner';
import { memo, useEffect, useState } from 'react';
import { useActiveProjectType } from '../../hooks/use-project-type';
import { InputRadio } from '../../inputs/input-radio';
import { layoutTypeOptions } from './index';

export const TypeInput = memo(() => {
    const editorEngine = useEditorEngine();
    const projectType = useActiveProjectType();
    const isExpoProject = projectType === ProjectType.EXPO;
    const [value, setValue] = useState<string>(
        editorEngine.style.selectedStyle?.styles.computed.display ?? 'block',
    );

    useEffect(() => {
        setValue(editorEngine.style.selectedStyle?.styles.computed.display ?? 'block');
    }, [editorEngine.style.selectedStyle?.styles.computed.display]);

    const typeOptions = Object.values(layoutTypeOptions).map((option) => ({
        ...option,
        disabled: isExpoProject && isUnsupportedNativewindStyleValue('display', option.value),
    }));

    return (
        <div className="flex items-center gap-0">
            <span className="text-sm text-muted-foreground w-20"> Type </span>
            <InputRadio
                options={typeOptions}
                value={value}
                onChange={(newValue) => {
                    if (isExpoProject && isUnsupportedNativewindStyleValue('display', newValue)) {
                        toast.warning('Grid layout is web-only and not supported in NativeWind projects');
                        return;
                    }
                    setValue(newValue);
                    editorEngine.style.update('display', newValue);
                }}
                className="flex-1"
            />
        </div>
    );
});
