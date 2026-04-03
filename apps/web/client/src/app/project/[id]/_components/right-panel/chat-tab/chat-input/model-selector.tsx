import { useEditorEngine } from '@/components/store/editor';
import { type OPENROUTER_MODELS, SELECTABLE_MODELS } from '@onlook/models';
import { Button } from '@onlook/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@onlook/ui/dropdown-menu';
import { Icons } from '@onlook/ui/icons';
import { cn } from '@onlook/ui/utils';
import { observer } from 'mobx-react-lite';

export const ModelSelector = observer(({ disabled = false }: { disabled?: boolean }) => {
    const editorEngine = useEditorEngine();
    const currentModel = editorEngine.state.chatModel;
    const currentLabel = SELECTABLE_MODELS.find(m => m.id === currentModel)?.label ?? 'Model';

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    className={cn(
                        'h-8 px-2 text-foreground-tertiary hover:text-foreground-secondary flex items-center gap-1',
                        disabled && 'opacity-50 cursor-not-allowed',
                    )}
                >
                    <Icons.Sparkles className="w-3 h-3" />
                    <span className="text-xs">{currentLabel}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
                {SELECTABLE_MODELS.map((model) => (
                    <DropdownMenuItem
                        key={model.id}
                        onClick={() => { editorEngine.state.chatModel = model.id as OPENROUTER_MODELS; }}
                        className={cn(
                            'flex items-center gap-2 px-3 py-2',
                            currentModel === model.id && 'bg-background-onlook',
                        )}
                    >
                        <span className="text-sm">{model.label}</span>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
});
