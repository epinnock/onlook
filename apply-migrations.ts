import { Client } from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const DATABASE_URL = process.env.SUPABASE_DATABASE_URL;

if (!DATABASE_URL) {
    console.error('SUPABASE_DATABASE_URL not set');
    process.exit(1);
}

async function applyMigrations() {
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    console.log('Connected to database');

    const migrationsDir = './apps/backend/supabase/migrations';
    const files = readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql') && !f.startsWith('meta'))
        .sort();

    for (const file of files) {
        console.log(`\nApplying migration: ${file}`);
        const sql = readFileSync(join(migrationsDir, file), 'utf-8');
        try {
            await client.query(sql);
            console.log(`✓ ${file} applied successfully`);
        } catch (err: any) {
            // Some migrations may have already been applied or conflict with drizzle-push
            // Log but continue
            console.log(`⚠ ${file}: ${err.message}`);
        }
    }

    await client.end();
    console.log('\nDone!');
}

applyMigrations().catch(console.error);
