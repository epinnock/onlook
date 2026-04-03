export const NATIVEWIND_SUPPORTED = {
    layout: ['flex', 'flex-row', 'flex-col', 'items-*', 'justify-*'],
    spacing: ['p-*', 'px-*', 'py-*', 'm-*', 'mx-*', 'my-*', 'gap-*'],
    sizing: ['w-*', 'h-*', 'min-w-*', 'min-h-*', 'max-w-*', 'max-h-*'],
    typography: ['text-*', 'font-*', 'leading-*', 'tracking-*'],
    colors: ['bg-*', 'text-*', 'border-*'],
    borders: ['border', 'border-*', 'rounded-*'],
} as const;

export const NATIVEWIND_UNSUPPORTED = [
    'grid',
    'grid-cols-*',
    'grid-rows-*',
    'fixed',
    'sticky',
    'hover:*',
    'focus:*',
    'backdrop-*',
    'animation-*',
    'transition-*',
] as const;

export const NATIVEWIND_UNSUPPORTED_STYLE_VALUES: Record<string, readonly string[]> = {
    display: ['grid', 'inline-grid'],
    position: ['fixed', 'sticky'],
};

export function isUnsupportedNativewindStyleValue(style: string, value: string): boolean {
    const unsupportedValues = NATIVEWIND_UNSUPPORTED_STYLE_VALUES[style];
    if (!unsupportedValues) {
        return false;
    }
    return unsupportedValues.includes(value);
}
