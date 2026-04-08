/**
 * Options for the ExpoBrowserProvider.
 *
 * The ExpoBrowser provider runs the Expo/RN preview entirely in the browser
 * via a Web Worker bundler (browser-metro) and persists files in Supabase
 * Storage. There is no remote sandbox runtime — the editor browser tab IS
 * the runtime.
 *
 * Sprint 0 ships only a stub. Sprint 1 (Wave A) wires real Supabase Storage
 * + browser-metro + the narrow command interceptor.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ExpoBrowserProviderOptions {
    /** Project UUID — used as the top-level Supabase Storage prefix. */
    projectId: string;
    /** Branch UUID — used as the second-level Supabase Storage prefix. */
    branchId: string;
    /**
     * Pre-built, authenticated Supabase client. Strongly preferred over
     * supabaseUrl + supabaseAnonKey because the editor's existing client
     * already has the user's session — passing it in fixes FOUND-R1.7
     * (the "Multiple GoTrueClient instances detected" warning that caused
     * Storage requests to go anonymously and trip RLS denials).
     */
    supabaseClient?: SupabaseClient;
    /**
     * Public-anon Supabase URL for browser-side reads.
     * Defaults to `process.env.NEXT_PUBLIC_SUPABASE_URL` when undefined.
     * Ignored when `supabaseClient` is provided.
     */
    supabaseUrl?: string;
    /**
     * Public anon key for the Supabase project.
     * Defaults to `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY` when undefined.
     * Ignored when `supabaseClient` is provided.
     */
    supabaseAnonKey?: string;
    /**
     * Storage bucket id. Defaults to 'expo-projects'.
     */
    storageBucket?: string;
    /**
     * URL of the self-hosted ESM CDN for npm package bundles.
     * Defaults to `process.env.NEXT_PUBLIC_BROWSER_METRO_ESM_URL` when undefined.
     */
    esmUrl?: string;
    /**
     * URL of the Expo Go relay (Sprint 3). Optional in Sprint 1.
     */
    relayUrl?: string;
}
