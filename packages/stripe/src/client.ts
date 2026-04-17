import { config } from 'dotenv';
import Stripe from 'stripe';

let envLoaded = false;

function ensureEnvLoaded() {
    if (envLoaded || typeof window !== 'undefined') {
        return;
    }

    config({ path: '../.env' });
    envLoaded = true;
}

export const createStripeClient = (secretKey?: string) => {
    // `@onlook/stripe` is imported from shared modules that also run during
    // project-page boot. Keep dotenv server-only and lazy so those imports
    // do not execute Node-specific env loading in the browser path.
    ensureEnvLoaded();
    const apiKey = secretKey || process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
        throw new Error('STRIPE_SECRET_KEY is not set');
    }
    return new Stripe(apiKey, { apiVersion: '2025-08-27.basil' });
};
