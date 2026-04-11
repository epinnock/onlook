
import { useEditorEngine } from '@/components/store/editor';
import { useUserFeatureFlags } from '@/hooks/use-user-feature-flags';
import { api } from '@/trpc/react';
import { DefaultSettings } from '@onlook/constants';
import { toDbProjectSettings } from '@onlook/db';
import { Button } from '@onlook/ui/button';
import { Icons } from '@onlook/ui/icons';
import { Input } from '@onlook/ui/input';
import { Separator } from '@onlook/ui/separator';
import { toast } from '@onlook/ui/sonner';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';

export const ProjectTab = observer(() => {
    const editorEngine = useEditorEngine();
    const utils = api.useUtils();
    const { data: project } = api.project.get.useQuery({ projectId: editorEngine.projectId });
    const { mutateAsync: updateProject } = api.project.update.useMutation();
    const { data: projectSettings } = api.settings.get.useQuery({ projectId: editorEngine.projectId });
    const { mutateAsync: updateProjectSettings } = api.settings.upsert.useMutation();

    const installCommand = projectSettings?.commands?.install ?? DefaultSettings.COMMANDS.install;
    const runCommand = projectSettings?.commands?.run ?? DefaultSettings.COMMANDS.run;
    const buildCommand = projectSettings?.commands?.build ?? DefaultSettings.COMMANDS.build;
    const name = project?.name ?? '';

    // Form state
    const [formData, setFormData] = useState({
        name: '',
        install: '',
        run: '',
        build: ''
    });
    const [isSaving, setIsSaving] = useState(false);

    // Initialize and sync form data
    useEffect(() => {
        setFormData({
            name,
            install: installCommand,
            run: runCommand,
            build: buildCommand
        });
    }, [name, installCommand, runCommand, buildCommand]);

    // Check if form has changes
    const isDirty = useMemo(() => {
        return (
            formData.name !== name ||
            formData.install !== installCommand ||
            formData.run !== runCommand ||
            formData.build !== buildCommand
        );
    }, [formData, name, installCommand, runCommand, buildCommand]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Update project name if changed
            if (formData.name !== name) {
                await updateProject({
                    id: editorEngine.projectId,
                    name: formData.name,
                });
                // Invalidate queries to refresh UI
                await Promise.all([
                    utils.project.list.invalidate(),
                    utils.project.get.invalidate({ projectId: editorEngine.projectId }),
                ]);
            }

            // Update commands if any changed
            if (formData.install !== installCommand || formData.run !== runCommand || formData.build !== buildCommand) {
                await updateProjectSettings({
                    projectId: editorEngine.projectId,
                    settings: toDbProjectSettings(editorEngine.projectId, {
                        commands: {
                            install: formData.install,
                            run: formData.run,
                            build: formData.build,
                        },
                    }),
                });
            }

            toast.success('Project settings updated successfully.');
        } catch (error) {
            console.error('Failed to update project settings:', error);
            toast.error('Failed to update project settings. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDiscard = () => {
        setFormData({
            name,
            install: installCommand,
            run: runCommand,
            build: buildCommand
        });
    };

    const updateField = (field: keyof typeof formData, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    // Wave I §0.5 — per-branch preview runtime toggle.
    // Visible only when (a) the user has the useExpoBrowserPreview flag and
    // (b) there's an active branch booted (so we know its current provider).
    const userFlags = useUserFeatureFlags();
    const activeBranch = editorEngine.branches.activeBranch;
    const currentProviderType = activeBranch?.sandbox?.providerType ?? 'code_sandbox';
    const showPreviewRuntimeToggle = userFlags.isEnabled('useExpoBrowserPreview') && !!activeBranch;
    const { mutateAsync: updateBranch } = api.branch.update.useMutation();
    const utilsForBranch = api.useUtils();
    const [isSwitchingRuntime, setIsSwitchingRuntime] = useState(false);

    const switchPreviewRuntime = async (next: 'code_sandbox' | 'expo_browser') => {
        if (!activeBranch || next === currentProviderType) return;
        setIsSwitchingRuntime(true);
        try {
            await updateBranch({
                id: activeBranch.id,
                providerType: next,
            });
            await utilsForBranch.branch.getByProjectId.invalidate({
                projectId: editorEngine.projectId,
            });
            toast.success(
                next === 'expo_browser'
                    ? 'Switched to browser preview. Reopen the branch to apply.'
                    : 'Switched to CodeSandbox. Reopen the branch to apply.',
            );
        } catch (error) {
            console.error('Failed to switch preview runtime:', error);
            toast.error('Failed to switch preview runtime.');
        } finally {
            setIsSwitchingRuntime(false);
        }
    };

    return (
        <div className="text-sm flex flex-col h-full">
            <div className="flex flex-col gap-4 p-6 pb-24 overflow-y-auto flex-1">
                <div className="flex flex-col gap-4">
                    <h2 className="text-lg">Metadata</h2>
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <p className="text-muted-foreground">Name</p>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) => updateField('name', e.target.value)}
                                className="w-2/3"
                                disabled={isSaving}
                            />
                        </div>
                    </div>
                </div>
                <Separator />

                {showPreviewRuntimeToggle && (
                    <>
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-col gap-2">
                                <h2 className="text-lg">Preview runtime</h2>
                                <p className="text-small text-foreground-secondary">
                                    Where this branch&rsquo;s preview runs. Browser preview costs $0 but doesn&rsquo;t support publish or remote git push (yet). Switch back to CodeSandbox any time — your sandbox is preserved.
                                </p>
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="preview-runtime"
                                        checked={currentProviderType === 'code_sandbox'}
                                        onChange={() => switchPreviewRuntime('code_sandbox')}
                                        disabled={isSwitchingRuntime}
                                    />
                                    <span>CodeSandbox (default — full Linux container)</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="preview-runtime"
                                        checked={currentProviderType === 'expo_browser'}
                                        onChange={() => switchPreviewRuntime('expo_browser')}
                                        disabled={isSwitchingRuntime}
                                    />
                                    <span>Browser preview (free — Expo / React Native only)</span>
                                </label>
                                {isSwitchingRuntime && (
                                    <span className="text-xs text-foreground-tertiary">
                                        Saving — reopen the branch for the new runtime to take effect.
                                    </span>
                                )}
                            </div>
                        </div>
                        <Separator />
                    </>
                )}

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <h2 className="text-lg">Commands</h2>
                        <p className="text-small text-foreground-secondary">
                            {"Only update these if you know what you're doing!"}
                        </p>
                    </div>
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <p className="text-muted-foreground">Install</p>
                            <Input
                                id="install"
                                value={formData.install}
                                onChange={(e) => updateField('install', e.target.value)}
                                className="w-2/3"
                                disabled={isSaving}
                            />
                        </div>
                        <div className="flex justify-between items-center">
                            <p className="text-muted-foreground">Run</p>
                            <Input
                                id="run"
                                value={formData.run}
                                onChange={(e) => updateField('run', e.target.value)}
                                className="w-2/3"
                                disabled={isSaving}
                            />
                        </div>
                        <div className="flex justify-between items-center">
                            <p className="text-muted-foreground">Build</p>
                            <Input
                                id="build"
                                value={formData.build}
                                onChange={(e) => updateField('build', e.target.value)}
                                className="w-2/3"
                                disabled={isSaving}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Save/Discard buttons matching site tab pattern */}
            <div className="sticky bottom-0 bg-background border-t border-border/50 p-6" style={{ borderTopWidth: '0.5px' }}>
                <div className="flex justify-end gap-4">
                    <Button
                        variant="outline"
                        className="flex items-center gap-2 px-4 py-2 bg-background border border-border/50"
                        type="button"
                        onClick={handleDiscard}
                        disabled={!isDirty || isSaving}
                    >
                        <span>Discard changes</span>
                    </Button>
                    <Button
                        variant="secondary"
                        className="flex items-center gap-2 px-4 py-2"
                        type="button"
                        onClick={handleSave}
                        disabled={!isDirty || isSaving}
                    >
                        {isSaving && <Icons.LoadingSpinner className="h-4 w-4 animate-spin" />}
                        <span>{isSaving ? 'Saving...' : 'Save changes'}</span>
                    </Button>
                </div>
            </div>
        </div>
    );
});