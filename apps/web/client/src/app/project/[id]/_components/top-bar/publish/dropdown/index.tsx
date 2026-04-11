import { useEditorEngine } from '@/components/store/editor';
import { useHostingType } from '@/components/store/hosting';
import { DeploymentType } from '@onlook/models';
import { Separator } from '@onlook/ui/separator';
import { observer } from 'mobx-react-lite';
import { AdvancedSettingsSection } from './advanced-settings';
import { CustomDomainSection } from './custom-domain';
import { LoadingState } from './loading';
import { PreviewDomainSection } from './preview-domain-section';

export const PublishDropdown = observer(() => {
    const editorEngine = useEditorEngine();
    const { isDeploying: isPreviewDeploying } = useHostingType(DeploymentType.PREVIEW);
    const { isDeploying: isCustomDeploying } = useHostingType(DeploymentType.CUSTOM);

    // Position B (§0.9 / Wave G): publishing is not yet supported for
    // ExpoBrowser branches. Show a clean disclaimer pointing the user back
    // to CodeSandbox. The branch's underlying CSB sandboxId is preserved,
    // so flipping the branch back to CSB in settings restores publish.
    const activeBranch = editorEngine.branches.activeBranch;
    const isBrowserPreview = activeBranch?.sandbox?.providerType === 'expo_browser';

    if (isBrowserPreview) {
        return (
            <div className="rounded-md flex flex-col text-foreground-secondary p-4 gap-2 max-w-xs">
                <p className="text-sm text-foreground">
                    Publishing isn&rsquo;t available in browser-preview mode yet.
                </p>
                <p className="text-xs text-foreground-tertiary">
                    To publish this branch, switch its preview runtime back to
                    CodeSandbox in branch settings. Your existing CSB sandbox is
                    preserved while ExpoBrowser is active.
                </p>
            </div>
        );
    }

    return (
        <div className="rounded-md flex flex-col text-foreground-secondary">
            {
                isPreviewDeploying ?
                    <LoadingState type={DeploymentType.PREVIEW} /> :
                    <PreviewDomainSection />
            }
            <Separator />
            {
                isCustomDeploying ?
                    <LoadingState type={DeploymentType.CUSTOM} /> :
                    <CustomDomainSection />
            }
            <Separator />
            <AdvancedSettingsSection />
        </div>
    );
});
