import { BaseTool, TOOLS_MAP } from '@onlook/ai';
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@onlook/ui/ai-elements';
import { Icons } from '@onlook/ui/icons';
import type { ToolUIPart } from 'ai';
import { memo } from 'react';
import { parseMcpToolName } from '../../code-display/mcp-app-utils';

const ToolCallSimpleComponent = ({
    toolPart,
    className,
    loading,
}: {
    toolPart: ToolUIPart;
    className?: string;
    loading?: boolean;
}) => {
    const toolName = toolPart.type.split('-')[1] ?? '';
    const ToolClass = TOOLS_MAP.get(toolName);

    // Use Globe icon for MCP tools, otherwise use the tool's icon or fallback
    const isMcpTool = toolName.startsWith('mcp_');
    const Icon = isMcpTool ? Icons.Globe : (ToolClass?.icon ?? Icons.QuestionMarkCircled);
    const title = ToolClass
        ? getToolLabel(ToolClass, toolPart.input)
        : isMcpTool
            ? getMcpToolLabel(toolName)
            : getDefaultToolLabel(toolName);

    return (
        <Tool className={className}>
            <ToolHeader loading={loading} title={title} type={toolPart.type} state={toolPart.state} icon={<Icon className="w-4 h-4 flex-shrink-0" />} />
            <ToolContent>
                <ToolInput input={toolPart.input} isStreaming={loading} />
                <ToolOutput errorText={toolPart.errorText} output={toolPart.output} isStreaming={loading} />
            </ToolContent>
        </Tool>
    );
};

export const ToolCallSimple = memo(ToolCallSimpleComponent);

function getDefaultToolLabel(toolName: string): string {
    return toolName?.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getMcpToolLabel(toolName: string): string {
    const parsed = parseMcpToolName(toolName);
    if (!parsed) {
        return getDefaultToolLabel(toolName);
    }
    const formattedTool = parsed.originalToolName.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `${parsed.serverName}: ${formattedTool}`;
}

function getToolLabel(toolClass: typeof BaseTool, input: unknown): string {
    try {
        return toolClass.getLabel(input);
    } catch (error) {
        console.error('Error getting tool label:', error);
        return getDefaultToolLabel(toolClass.name);
    }
}