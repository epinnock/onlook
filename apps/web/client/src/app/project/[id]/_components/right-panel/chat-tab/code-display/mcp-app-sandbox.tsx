'use client';

import { forwardRef } from 'react';
import { cn } from '@onlook/ui/utils';

interface McpAppSandboxProps {
    htmlContent: string;
    className?: string;
    height?: number;
}

/**
 * Renders MCP App HTML content in a strictly sandboxed iframe.
 *
 * Security:
 * - sandbox="allow-scripts" only — no same-origin, no forms, no popups
 * - referrerpolicy="no-referrer" — no referrer leakage
 * - The iframe cannot access the host's cookies, storage, or DOM
 * - All communication happens through postMessage
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
