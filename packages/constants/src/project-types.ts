export enum ProjectType {
    NEXTJS = 'nextjs',
    EXPO = 'expo',
}

const NEXTJS_MARKERS = ['next.config.ts', 'next.config.js', 'next.config.mjs', 'next.config.cjs'];
const EXPO_MARKERS = ['app.json', 'expo.json'];

export function detectProjectType(files: string[]): ProjectType {
    const normalizedFiles = files.map((file) => file.toLowerCase());

    if (normalizedFiles.some((file) => EXPO_MARKERS.includes(file))) {
        return ProjectType.EXPO;
    }

    if (normalizedFiles.some((file) => NEXTJS_MARKERS.includes(file))) {
        return ProjectType.NEXTJS;
    }

    return ProjectType.NEXTJS;
}
