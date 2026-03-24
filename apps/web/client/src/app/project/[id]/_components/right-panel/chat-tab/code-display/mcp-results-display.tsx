'use client';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@onlook/ui/collapsible';
import { Icons } from '@onlook/ui/icons';
import { cn } from '@onlook/ui/utils';
import { AnimatePresence, motion } from 'motion/react';
import { memo, useState } from 'react';

interface ComponentResult {
    name: string;
    score?: number;
    screenshotUrl?: string;
    searchableText?: string;
    figmaUrl?: string;
    githubUrl?: string;
    storybookUrl?: string;
    tags?: string[];
    projectId?: string;
}

interface McpResultsDisplayProps {
    results: ComponentResult[];
    summary: string;
    toolName: string;
}

const McpResultsDisplayComponent = ({ results, summary, toolName }: McpResultsDisplayProps) => {
    const [isOpen, setIsOpen] = useState(true);

    return (
        <div className="group relative my-3">
            <Collapsible open={isOpen} onOpenChange={setIsOpen}>
                <div className={cn(
                    'border rounded-lg bg-background-primary relative',
                    !isOpen && 'group-hover:bg-background-secondary',
                )}>
                    <div className={cn(
                        'flex items-center justify-between text-foreground-secondary',
                        !isOpen && 'group-hover:text-foreground-primary',
                    )}>
                        <CollapsibleTrigger asChild>
                            <div className="flex-1 flex items-center gap-2 cursor-pointer pl-3 py-2">
                                <Icons.ChevronDown className={cn(
                                    'h-4 w-4 transition-transform duration-200',
                                    isOpen && 'rotate-180',
                                )} />
                                <div className="text-small pointer-events-none select-none flex items-center gap-1.5 min-w-0">
                                    <Icons.Globe className="h-3.5 w-3.5 flex-shrink-0" />
                                    <span className="truncate">{summary}</span>
                                </div>
                            </div>
                        </CollapsibleTrigger>
                    </div>

                    <CollapsibleContent forceMount>
                        <AnimatePresence mode="wait">
                            <motion.div
                                key="results-content"
                                initial={isOpen ? { height: 'auto', opacity: 1 } : { height: 0, opacity: 0 }}
                                animate={isOpen ? { height: 'auto', opacity: 1 } : { height: 0, opacity: 0 }}
                                transition={{ duration: 0.2, ease: 'easeInOut' }}
                                style={{ overflow: 'hidden' }}
                            >
                                {isOpen && (
                                    <div className="border-t">
                                        <div className="grid grid-cols-2 gap-2 p-3 max-h-[400px] overflow-y-auto">
                                            {results.map((result, idx) => (
                                                <ComponentCard key={`${result.name}-${idx}`} result={result} />
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </motion.div>
                        </AnimatePresence>
                    </CollapsibleContent>
                </div>
            </Collapsible>
        </div>
    );
};

const ComponentCard = ({ result }: { result: ComponentResult }) => {
    const [imgError, setImgError] = useState(false);

    return (
        <div className="border rounded-md overflow-hidden bg-background-secondary hover:border-foreground-tertiary transition-colors">
            {result.screenshotUrl && !imgError ? (
                <div className="relative w-full h-24 bg-background-primary">
                    <img
                        src={result.screenshotUrl}
                        alt={result.name}
                        className="w-full h-full object-contain"
                        onError={() => setImgError(true)}
                        loading="lazy"
                    />
                </div>
            ) : (
                <div className="w-full h-16 bg-background-primary flex items-center justify-center">
                    <Icons.Globe className="h-5 w-5 text-foreground-tertiary opacity-30" />
                </div>
            )}
            <div className="p-2">
                <p className="text-mini font-medium truncate">{result.name}</p>
                {result.score != null && (
                    <p className="text-mini text-foreground-tertiary">
                        {(result.score * 100).toFixed(0)}% match
                    </p>
                )}
                {result.tags && result.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                        {result.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="text-[10px] px-1 py-0.5 bg-background-primary rounded text-foreground-tertiary">
                                {tag}
                            </span>
                        ))}
                    </div>
                )}
                <div className="flex gap-1.5 mt-1">
                    {result.figmaUrl && (
                        <a href={result.figmaUrl} target="_blank" rel="noopener noreferrer" className="text-foreground-tertiary hover:text-foreground-primary">
                            <Icons.ExternalLink className="h-3 w-3" />
                        </a>
                    )}
                </div>
            </div>
        </div>
    );
};

export const McpResultsDisplay = memo(McpResultsDisplayComponent);

/**
 * Checks if an MCP tool output contains structuredContent with component results.
 *
 * The AI SDK wraps tool outputs in { type: "json", value: <raw> } or { type: "text", value: string }.
 * The raw MCP CallToolResult is: { content: [...], structuredContent: {...}, isError: false }.
 */
export function getMcpStructuredResults(output: unknown): {
    results: ComponentResult[];
    summary: string;
} | null {
    if (!output || typeof output !== 'object') return null;

    const out = output as Record<string, unknown>;

    // The AI SDK wraps tool output as { type: "json", value: { content, structuredContent, ... } }
    // Unwrap if needed
    const raw = (out.type === 'json' && out.value && typeof out.value === 'object')
        ? out.value as Record<string, unknown>
        : out;

    // Check for structuredContent (MCP Apps format)
    const sc = raw.structuredContent as Record<string, unknown> | undefined;
    if (sc?.results && Array.isArray(sc.results)) {
        return {
            results: sc.results as ComponentResult[],
            summary: (sc.summary as string) || `${sc.results.length} results`,
        };
    }

    return null;
}
