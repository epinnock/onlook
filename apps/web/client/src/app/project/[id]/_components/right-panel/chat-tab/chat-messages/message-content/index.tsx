import type { ChatMessage } from '@onlook/models';
import { Reasoning, ReasoningContent, ReasoningTrigger, Response } from '@onlook/ui/ai-elements';
import { cn } from '@onlook/ui/utils';
import type { DynamicToolUIPart, ToolUIPart } from 'ai';
import { observer } from 'mobx-react-lite';
import { ToolCallDisplay } from './tool-call-display';

/** Check if a message part is a tool call (static tool-* or dynamic-tool from MCP) */
function isToolPart(part: { type: string }): boolean {
    return part.type.startsWith('tool-') || part.type === 'dynamic-tool';
}

/** Normalize a tool part to ToolUIPart shape for consistent handling */
function asToolUIPart(part: unknown): ToolUIPart {
    const p = part as Record<string, unknown>;
    // Dynamic MCP tools have type 'dynamic-tool' with toolName as a separate field.
    // Normalize to match ToolUIPart expectations in ToolCallDisplay.
    if (p.type === 'dynamic-tool') {
        return { ...p, type: `tool-${p.toolName}` } as unknown as ToolUIPart;
    }
    return part as ToolUIPart;
}

const MessageContentComponent = ({
    messageId,
    parts,
    applied,
    isStream,
}: {
    messageId: string;
    parts: ChatMessage['parts'];
    applied: boolean;
    isStream: boolean;
}) => {
    let lastIncompleteToolIndex = -1;
    if (isStream) {
        for (let i = parts.length - 1; i >= 0; i--) {
            const part = parts[i];
            if (part && isToolPart(part)) {
                const toolPart = asToolUIPart(part);
                if (toolPart.state !== 'output-available') {
                    lastIncompleteToolIndex = i;
                    break;
                }
            }
        }
    }

    const renderedParts = parts.map((part, idx) => {
        if (part?.type === 'text') {
            return (
                <Response key={part.text}>
                    {part.text}
                </Response>

            );
        } else if (part && isToolPart(part)) {
            const toolPart = asToolUIPart(part);
            console.log(`[MCP discovery/client] Rendering tool part: type=${part.type} normalized=${toolPart.type} toolCallId=${toolPart.toolCallId} state=${toolPart.state}`);
            const isLoadingThisTool = isStream && idx === lastIncompleteToolIndex;
            return (
                <ToolCallDisplay
                    messageId={messageId}
                    toolPart={toolPart}
                    key={toolPart.toolCallId}
                    isStream={isLoadingThisTool}
                    applied={applied}
                />
            );
        } else if (part?.type === 'reasoning') {
            const isLastPart = idx === parts.length - 1;
            return (
                <Reasoning key={part.text} className={cn(
                    "m-0 items-center gap-2 text-foreground-tertiary",
                    isStream && isLastPart && "bg-gradient-to-l from-white/20 via-white/90 to-white/20 bg-[length:200%_100%] bg-clip-text text-transparent animate-shimmer filter drop-shadow-[0_0_10px_rgba(255,255,255,0.4)]"
                )} isStreaming={isStream}>
                    <ReasoningTrigger />
                    <ReasoningContent className="text-xs">{part.text}</ReasoningContent>
                </Reasoning>
            );
        }
    })

    return (
        <div className="select-text">
            {renderedParts}
        </div>
    );
};

export const MessageContent = observer(MessageContentComponent);
