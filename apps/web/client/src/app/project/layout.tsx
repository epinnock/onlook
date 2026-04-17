import { Routes } from '@/utils/constants';
import { createClient } from '@/utils/supabase/server';
import { checkUserSubscriptionAccess } from '@/utils/subscription';
import { redirect } from 'next/navigation';

export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
        redirect(Routes.LOGIN);
    }

    // Check if user has an active subscription
    const { hasActiveSubscription, hasLegacySubscription } = await checkUserSubscriptionAccess(
        user.id,
        user.email,
    );

    // If no subscription, redirect to demo page
    if (!hasActiveSubscription && !hasLegacySubscription) {
        redirect(Routes.DEMO_ONLY);
    }

    return <>{children}</>;
}
