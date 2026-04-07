import { relations, sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { projectInvitations } from '../project';
import { usageRecords } from '../subscription';
import { subscriptions } from '../subscription/subscription';
import { authUsers } from '../supabase';
import { userSettings } from './settings';
import { userCanvases } from './user-canvas';
import { userProjects } from './user-project';

/**
 * Per-user feature flag map. Persisted in users.feature_flags as a jsonb
 * column. Read by the new useUserFeatureFlags hook (see Wave I §0.5) to gate
 * the per-branch "Preview runtime" toggle in the project settings UI.
 *
 * The existing env-based feature-flags.ts is unchanged — that one stays for
 * build-time deployment flags. This jsonb column is the per-user/per-account
 * mechanism that lets us dogfood ExpoBrowser before wider rollout.
 */
export interface UserFeatureFlags {
    /**
     * When true, the per-branch ExpoBrowser preview runtime toggle is
     * visible in project settings. When false (or absent), every branch is
     * forced to code_sandbox regardless of the branches.provider_type column.
     */
    useExpoBrowserPreview?: boolean;
}

export const users = pgTable('users', {
    id: uuid('id')
        .primaryKey()
        .references(() => authUsers.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    firstName: text('first_name'),
    lastName: text('last_name'),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    stripeCustomerId: text('stripe_customer_id'),
    githubInstallationId: text('github_installation_id'),
    featureFlags: jsonb('feature_flags').$type<UserFeatureFlags>().notNull().default(sql`'{}'::jsonb`),
}).enableRLS();

export const usersRelations = relations(users, ({ many, one }) => ({
    userCanvases: many(userCanvases),
    userProjects: many(userProjects),
    userSettings: one(userSettings),
    authUser: one(authUsers),
    subscriptions: many(subscriptions),
    usageRecords: many(usageRecords),
    projectInvitations: many(projectInvitations),
}));

export const userInsertSchema = createInsertSchema(users);
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
