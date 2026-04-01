export const RN_COMPONENT_PALETTE = {
    container: {
        tag: 'View',
        import: { from: 'react-native', named: 'View' },
        defaultProps: { className: 'flex' },
        domFallbackTag: 'div',
    },
    text: {
        tag: 'Text',
        import: { from: 'react-native', named: 'Text' },
        defaultProps: {},
        domFallbackTag: 'span',
    },
    image: {
        tag: 'Image',
        import: { from: 'react-native', named: 'Image' },
        defaultProps: {},
        domFallbackTag: 'img',
    },
    scrollView: {
        tag: 'ScrollView',
        import: { from: 'react-native', named: 'ScrollView' },
        defaultProps: {},
        domFallbackTag: 'div',
    },
    pressable: {
        tag: 'Pressable',
        import: { from: 'react-native', named: 'Pressable' },
        defaultProps: {},
        domFallbackTag: 'button',
    },
    textInput: {
        tag: 'TextInput',
        import: { from: 'react-native', named: 'TextInput' },
        defaultProps: { placeholder: 'Enter text' },
        domFallbackTag: 'input',
    },
} as const;

export const RN_COMPONENT_TAGS: ReadonlySet<string> = new Set(
    Object.values(RN_COMPONENT_PALETTE).map((component) => component.tag),
);

export const RN_COMPONENT_IMPORT_NAMES: ReadonlySet<string> = new Set(
    Object.values(RN_COMPONENT_PALETTE).map((component) => component.import.named),
);

export const RN_DOM_FALLBACK_TAGS = Object.fromEntries(
    Object.values(RN_COMPONENT_PALETTE).map((component) => [
        component.tag,
        component.domFallbackTag,
    ]),
) as Record<string, string>;

export function isReactNativeComponentTag(tagName: string): boolean {
    return RN_COMPONENT_TAGS.has(tagName);
}

export function getDomFallbackTagForReactNative(tagName: string): string {
    return RN_DOM_FALLBACK_TAGS[tagName] ?? tagName.toLowerCase();
}
