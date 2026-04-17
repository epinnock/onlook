import { readInlineSourceMap, type MobilePreviewSourceMap } from './bundler/source-map';

export interface MobilePreviewGeneratedPosition {
    line: number;
    column: number;
}

export interface MobilePreviewMappedSourceLocation {
    filePath: string;
    line: number;
    column: number;
}

export interface MobilePreviewMappedRuntimeError {
    message: string;
    generatedPosition: MobilePreviewGeneratedPosition | null;
    sourceLocation: MobilePreviewMappedSourceLocation | null;
}

interface DecodedMappingSegment {
    generatedColumn: number;
    sourceIndex?: number;
    originalLine?: number;
    originalColumn?: number;
}

interface BundleModuleSegment {
    filePath: string;
    bodyStartLine: number;
    bodyEndLine: number;
    sourceMap: MobilePreviewSourceMap | null;
}

const BASE64_VLQ_CHARS =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const MODULE_HEADER_RE = /^"((?:\\.|[^"])*)": function\(require, module, exports\) \{$/;

export function extractGeneratedPositionFromRuntimeError(
    message: string,
): MobilePreviewGeneratedPosition | null {
    let match: RegExpExecArray | null = null;

    for (const candidate of message.matchAll(/(\d+):(\d+)/g)) {
        match = candidate;
    }

    if (!match || match[1] == null || match[2] == null) {
        return null;
    }

    const line = Number.parseInt(match[1], 10);
    const column = Number.parseInt(match[2], 10);
    if (!Number.isFinite(line) || !Number.isFinite(column)) {
        return null;
    }

    return { line, column };
}

export function formatMappedMobilePreviewRuntimeErrorMessage(
    message: string,
    sourceLocation: MobilePreviewMappedSourceLocation | null,
): string {
    const trimmedMessage = message.trim();
    if (!sourceLocation) {
        return trimmedMessage;
    }

    const sourceLabel = `${sourceLocation.filePath}:${sourceLocation.line}:${sourceLocation.column}`;
    if (trimmedMessage.includes(sourceLabel)) {
        return trimmedMessage;
    }

    return `${trimmedMessage} (${sourceLabel})`;
}

export function mapMobilePreviewRuntimeError(
    message: string,
    bundleCode: string,
): MobilePreviewMappedRuntimeError {
    const generatedPosition = extractGeneratedPositionFromRuntimeError(message);
    const sourceLocation =
        generatedPosition == null
            ? null
            : mapBundlePositionToSource(bundleCode, generatedPosition);

    return {
        message: formatMappedMobilePreviewRuntimeErrorMessage(
            message,
            sourceLocation,
        ),
        generatedPosition,
        sourceLocation,
    };
}

function mapBundlePositionToSource(
    bundleCode: string,
    position: MobilePreviewGeneratedPosition,
): MobilePreviewMappedSourceLocation | null {
    const moduleSegment = collectBundleModuleSegments(bundleCode).find(
        (segment) =>
            position.line >= segment.bodyStartLine &&
            position.line <= segment.bodyEndLine,
    );
    if (!moduleSegment?.sourceMap) {
        return null;
    }

    const moduleGeneratedLine = position.line - moduleSegment.bodyStartLine + 1;
    const moduleGeneratedColumn = Math.max(position.column - 1, 0);
    const sourceLocation = mapModulePositionToSource(
        moduleSegment.sourceMap,
        moduleGeneratedLine,
        moduleGeneratedColumn,
    );

    if (sourceLocation) {
        return sourceLocation;
    }

    const fallbackFilePath =
        moduleSegment.sourceMap.sources[0] ?? moduleSegment.filePath;
    return {
        filePath: fallbackFilePath,
        line: moduleGeneratedLine,
        column: position.column,
    };
}

function collectBundleModuleSegments(bundleCode: string): BundleModuleSegment[] {
    const lines = bundleCode.split('\n');
    const headers: Array<{ filePath: string; line: number }> = [];

    for (let index = 0; index < lines.length; index += 1) {
        const match = lines[index]?.match(MODULE_HEADER_RE);
        if (!match) {
            continue;
        }

        headers.push({
            filePath: JSON.parse(`"${match[1]}"`) as string,
            line: index + 1,
        });
    }

    if (headers.length === 0) {
        return [];
    }

    const modulesObjectEndLine =
        lines.findIndex(
            (line, index) => index >= headers[0]!.line - 1 && line === '};',
        ) + 1;

    return headers.flatMap((header, index) => {
        const nextBoundaryLine =
            headers[index + 1]?.line ?? modulesObjectEndLine;
        const bodyStartLine = header.line + 1;
        const bodyEndLine = nextBoundaryLine - 2;
        if (bodyEndLine < bodyStartLine) {
            return [];
        }

        const moduleCode = lines
            .slice(bodyStartLine - 1, bodyEndLine)
            .join('\n');

        return [
            {
                filePath: header.filePath,
                bodyStartLine,
                bodyEndLine,
                sourceMap: readInlineSourceMap(moduleCode),
            },
        ];
    });
}

function mapModulePositionToSource(
    sourceMap: MobilePreviewSourceMap,
    generatedLine: number,
    generatedColumn: number,
): MobilePreviewMappedSourceLocation | null {
    const mappings = decodeMappings(sourceMap.mappings);
    const lineSegments = mappings[generatedLine - 1] ?? [];

    let selectedSegment: DecodedMappingSegment | null = null;
    for (const segment of lineSegments) {
        if (segment.sourceIndex == null) {
            continue;
        }
        if (segment.generatedColumn <= generatedColumn) {
            selectedSegment = segment;
            continue;
        }
        break;
    }

    const resolvedSegment =
        selectedSegment ??
        lineSegments.find((segment) => segment.sourceIndex != null) ??
        null;
    if (
        !resolvedSegment ||
        resolvedSegment.sourceIndex == null ||
        resolvedSegment.originalLine == null ||
        resolvedSegment.originalColumn == null
    ) {
        return null;
    }

    const filePath =
        sourceMap.sources[resolvedSegment.sourceIndex] ?? sourceMap.file;

    return {
        filePath,
        line: resolvedSegment.originalLine + 1,
        column: resolvedSegment.originalColumn + 1,
    };
}

function decodeMappings(mappings: string): DecodedMappingSegment[][] {
    const decodedLines: DecodedMappingSegment[][] = [];
    let previousSourceIndex = 0;
    let previousOriginalLine = 0;
    let previousOriginalColumn = 0;
    let previousNameIndex = 0;

    for (const line of mappings.split(';')) {
        let previousGeneratedColumn = 0;
        const decodedLine: DecodedMappingSegment[] = [];

        if (line.length > 0) {
            for (const segment of line.split(',')) {
                if (!segment) {
                    continue;
                }

                const values = decodeVlq(segment);
                previousGeneratedColumn += values[0] ?? 0;

                if (values.length < 4) {
                    decodedLine.push({
                        generatedColumn: previousGeneratedColumn,
                    });
                    continue;
                }

                previousSourceIndex += values[1] ?? 0;
                previousOriginalLine += values[2] ?? 0;
                previousOriginalColumn += values[3] ?? 0;

                if (values.length >= 5) {
                    previousNameIndex += values[4] ?? 0;
                }

                decodedLine.push({
                    generatedColumn: previousGeneratedColumn,
                    sourceIndex: previousSourceIndex,
                    originalLine: previousOriginalLine,
                    originalColumn: previousOriginalColumn,
                });
            }
        }

        decodedLines.push(decodedLine);
    }

    return decodedLines;
}

function decodeVlq(value: string): number[] {
    const decoded: number[] = [];
    let shift = 0;
    let current = 0;

    for (const char of value) {
        const index = BASE64_VLQ_CHARS.indexOf(char);
        if (index < 0) {
            throw new Error(`Unsupported source-map VLQ char: ${char}`);
        }

        const continuation = (index & 32) === 32;
        const digit = index & 31;
        current += digit << shift;

        if (continuation) {
            shift += 5;
            continue;
        }

        const isNegative = (current & 1) === 1;
        decoded.push(isNegative ? -(current >> 1) : current >> 1);
        current = 0;
        shift = 0;
    }

    return decoded;
}
