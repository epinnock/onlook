'use client';

import { forwardRef } from 'react';
import { cn } from '@onlook/ui/utils';

interface McpAppSandboxProps {
    htmlContent: string;
    className?: string;
    height?: number;
}

/**
 * Renders MCP App HTML content in a sandboxed iframe.
 *
 * Uses srcdoc for the widget HTML. The parent component (McpAppDisplay)
 * is responsible for ensuring the postMessage bridge is listening before
 * this component mounts.
 */
export const McpAppSandbox = forwardRef<HTMLIFrameElement, McpAppSandboxProps>(
    ({ htmlContent, className, height = 200 }, ref) => {
        return (
            <iframe
                ref={ref}
                srcDoc={htmlContent}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                className={cn('w-full border-0', className)}
                style={{
                    height,
                    minHeight: 120,
                    maxHeight: 400,
                }}
                title="MCP App"
            />
        );
    },
);

McpAppSandbox.displayName = 'McpAppSandbox';
