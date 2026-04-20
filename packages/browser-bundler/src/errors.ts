export interface BrowserBundlerEditorError {
    readonly message: string;
    readonly file?: string;
    readonly line?: number;
    readonly column?: number;
    readonly detail?: string;
}

interface BrowserBundlerErrorLocation {
    readonly file?: unknown;
    readonly line?: unknown;
    readonly column?: unknown;
}

interface BrowserBundlerErrorNote {
    readonly text?: unknown;
}

interface BrowserBundlerErrorShape {
    readonly message?: unknown;
    readonly text?: unknown;
    readonly detail?: unknown;
    readonly file?: unknown;
    readonly line?: unknown;
    readonly column?: unknown;
    readonly location?: BrowserBundlerErrorLocation;
    readonly notes?: readonly BrowserBundlerErrorNote[];
    readonly errors?: readonly unknown[];
    readonly cause?: unknown;
}

export function normalizeBrowserBundlerError(error: unknown): readonly BrowserBundlerEditorError[] {
    if (Array.isArray(error)) {
        return error.flatMap((entry) => normalizeBrowserBundlerError(entry));
    }

    if (error instanceof Error) {
        return [
            {
                message: error.message || 'Unknown error',
                detail: error.stack ?? undefined,
            },
        ];
    }

    if (!isObject(error)) {
        return [{ message: stringifyErrorValue(error) }];
    }

    const typedError = error as BrowserBundlerErrorShape;

    if (Array.isArray(typedError.errors) && typedError.errors.length > 0) {
        const normalizedErrors = typedError.errors.flatMap((entry) => normalizeBrowserBundlerError(entry));

        if (normalizedErrors.length > 0) {
            return normalizedErrors;
        }
    }

    const normalizedMessage = normalizeBrowserBundlerErrorShape(typedError);
    if (normalizedMessage) {
        return [normalizedMessage];
    }

    if (typedError.cause !== undefined && typedError.cause !== error) {
        const normalizedCause = normalizeBrowserBundlerError(typedError.cause);
        if (normalizedCause.length > 0) {
            return normalizedCause;
        }
    }

    return [{ message: 'Unknown error' }];
}

export const normalizeBrowserBundlerErrors = normalizeBrowserBundlerError;

function normalizeBrowserBundlerErrorShape(
    error: BrowserBundlerErrorShape,
): BrowserBundlerEditorError | undefined {
    const message = readText(error.text) ?? readText(error.message);
    if (!message) {
        return undefined;
    }

    const location = error.location;
    const file = readText(error.file) ?? readText(location?.file);
    const line = readNumber(error.line) ?? readNumber(location?.line);
    const column = readNumber(error.column) ?? readNumber(location?.column);
    const detail = createDetail(error);

    return {
        message,
        ...(file ? { file } : {}),
        ...(line !== undefined ? { line } : {}),
        ...(column !== undefined ? { column } : {}),
        ...(detail ? { detail } : {}),
    };
}

function createDetail(error: BrowserBundlerErrorShape): string | undefined {
    const parts: string[] = [];

    if (typeof error.detail === 'string' && error.detail.trim().length > 0) {
        parts.push(error.detail);
    }

    if (Array.isArray(error.notes)) {
        for (const note of error.notes) {
            const text = readText(note.text);
            if (text) {
                parts.push(text);
            }
        }
    }

    return parts.length > 0 ? parts.join('\n') : undefined;
}

function readText(value: unknown): string | undefined {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }

    return undefined;
}

function readNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function stringifyErrorValue(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value);
    }

    if (typeof value === 'symbol') {
        return value.description ? `Symbol(${value.description})` : 'Symbol()';
    }

    return 'Unknown error';
}
