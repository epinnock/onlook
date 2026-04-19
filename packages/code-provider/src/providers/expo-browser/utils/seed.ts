/**
 * Seed a Supabase Storage bucket with the starter files for a new ExpoBrowser
 * project. Called from the tRPC `project.create` mutation right after the
 * projects/branches rows land, so the editor's first `listFiles('.')` call
 * returns a usable file tree.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
    EXPO_BROWSER_TEMPLATES,
    type ExpoBrowserTemplateFile,
    type ExpoBrowserTemplateId,
} from '../templates/expo-blank';

const DEFAULT_BUCKET = 'expo-projects';

export interface SeedExpoBrowserStorageOptions {
    projectId: string;
    branchId: string;
    client: SupabaseClient;
    bucket?: string;
    /** Defaults to 'expo_blank'. */
    template?: ExpoBrowserTemplateId;
    /** Override the template file list (used by tests). */
    files?: readonly ExpoBrowserTemplateFile[];
}

export interface SeedExpoBrowserStorageResult {
    uploadedPaths: string[];
}

/**
 * Uploads each template file to `{bucket}/{projectId}/{branchId}/{path}`.
 * Uses upsert so the call is idempotent — re-seeding a project simply
 * overwrites whatever's there.
 */
export async function seedExpoBrowserStorage(
    options: SeedExpoBrowserStorageOptions,
): Promise<SeedExpoBrowserStorageResult> {
    const bucket = options.bucket ?? DEFAULT_BUCKET;
    const templateId = options.template ?? 'expo_blank';
    const files =
        options.files ??
        EXPO_BROWSER_TEMPLATES[templateId];

    if (!files || files.length === 0) {
        throw new Error(
            `seedExpoBrowserStorage: unknown template id "${templateId}"`,
        );
    }

    const prefix = `${options.projectId}/${options.branchId}`;
    const storage = options.client.storage.from(bucket);
    const uploadedPaths: string[] = [];

    for (const file of files) {
        const key = `${prefix}/${file.path}`;
        const body = new Blob([file.content], { type: 'text/plain' });
        const { error } = await storage.upload(key, body, {
            upsert: true,
            contentType: 'text/plain',
        });
        if (error) {
            throw new Error(
                `seedExpoBrowserStorage: upload failed for ${key}: ${error.message}`,
            );
        }
        uploadedPaths.push(file.path);
    }

    return { uploadedPaths };
}
