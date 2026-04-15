'use client';

import { IDE } from '@/components/ide';
import type { MobilePreviewErrorPanelModel } from '@/services/mobile-preview/error-store';
import { DEFAULT_IDE } from '@onlook/models';

const FILE_LINK_RE =
    /(?:^|[\s([{\u201c'"])(\.{0,2}\/[^\s():]+|\/[^\s():]+|[A-Za-z0-9_@-][A-Za-z0-9_./@-]*\.[A-Za-z0-9]+):(\d+)(?::(\d+))?/g;

interface TextSegment {
    type: 'text';
    value: string;
}

interface LinkSegment {
    type: 'link';
    value: string;
    filePath: string;
    line: number;
}

type MessageSegment = TextSegment | LinkSegment;

export interface MobilePreviewErrorPanelProps {
    panel: MobilePreviewErrorPanelModel;
}

function appendTextSegment(segments: MessageSegment[], value: string) {
    if (!value) {
        return;
    }

    const last = segments[segments.length - 1];
    if (last?.type === 'text') {
        last.value += value;
        return;
    }

    segments.push({ type: 'text', value });
}

export function splitMobilePreviewErrorMessage(
    message: string,
): MessageSegment[] {
    const segments: MessageSegment[] = [];
    let cursor = 0;

    for (const match of message.matchAll(FILE_LINK_RE)) {
        const matchText = match[0];
        const pathWithLine = match[1];
        const lineText = match[2];
        if (!pathWithLine || !lineText) {
            continue;
        }

        const matchIndex = match.index ?? -1;
        if (matchIndex < 0) {
            continue;
        }

        const linkOffset = matchText.lastIndexOf(pathWithLine);
        if (linkOffset < 0) {
            continue;
        }

        const linkStart = matchIndex + linkOffset;
        const linkEnd =
            linkStart +
            pathWithLine.length +
            1 +
            lineText.length +
            (match[3] ? match[3].length + 1 : 0);
        appendTextSegment(segments, message.slice(cursor, linkStart));
        segments.push({
            type: 'link',
            value: message.slice(linkStart, linkEnd),
            filePath: pathWithLine,
            line: Number.parseInt(lineText, 10),
        });
        cursor = linkEnd;
    }

    appendTextSegment(segments, message.slice(cursor));

    return segments.length > 0 ? segments : [{ type: 'text', value: message }];
}

export function MobilePreviewErrorPanel({
    panel,
}: MobilePreviewErrorPanelProps) {
    if (!panel.isVisible || panel.items.length === 0) {
        return null;
    }

    const ide = IDE.fromType(DEFAULT_IDE);

    return (
        <section
            data-testid="mobile-preview-error-panel"
            className="flex flex-col gap-3 rounded-lg border border-red-500/30 bg-red-500/8 p-3"
            aria-live="polite"
        >
            <div className="flex items-center justify-between gap-2">
                <div>
                    <h2 className="text-sm font-medium text-foreground">
                        Preview errors
                    </h2>
                    <p className="text-xs text-foreground-secondary">
                        Fix these before pushing another mobile preview update.
                    </p>
                </div>
                <span className="rounded-full bg-red-500/12 px-2 py-1 text-[11px] font-medium text-red-300">
                    {panel.items.length}
                </span>
            </div>

            <div className="flex flex-col gap-2">
                {panel.items.map((item) => (
                    <article
                        key={item.id}
                        data-testid={`mobile-preview-error-item-${item.id}`}
                        className="rounded-md border border-border/60 bg-background/70 p-3"
                    >
                        <div className="flex items-center justify-between gap-2">
                            <h3 className="text-sm font-medium text-foreground">
                                {item.title}
                            </h3>
                            {item.occurrences > 1 && (
                                <span
                                    data-testid={`mobile-preview-error-occurrences-${item.id}`}
                                    className="rounded-full bg-background-secondary px-2 py-0.5 text-[11px] text-foreground-secondary"
                                >
                                    {item.occurrences}x
                                </span>
                            )}
                        </div>
                        <p
                            data-testid={`mobile-preview-error-message-${item.id}`}
                            className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground-secondary"
                        >
                            {splitMobilePreviewErrorMessage(item.message).map(
                                (segment, index) => {
                                    if (segment.type === 'text') {
                                        return (
                                            <span key={`${item.id}-text-${index}`}>
                                                {segment.value}
                                            </span>
                                        );
                                    }

                                    return (
                                        <a
                                            key={`${item.id}-link-${index}`}
                                            data-testid={`mobile-preview-error-link-${item.id}-${index}`}
                                            href={ide.getCodeFileCommand(
                                                segment.filePath,
                                                segment.line,
                                            )}
                                            className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                                        >
                                            {segment.value}
                                        </a>
                                    );
                                },
                            )}
                        </p>
                    </article>
                ))}
            </div>
        </section>
    );
}
