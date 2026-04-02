'use client';

import { useAuthContext } from '@/app/auth/auth-context';
import { CurrentUserAvatar } from '@/components/ui/avatar-dropdown';
import { transKeys } from '@/i18n/keys';
import { isProviderEnabled } from '@/lib/feature-flags';
import { api } from '@/trpc/react';
import { LocalForageKeys, Routes } from '@/utils/constants';
import { SandboxTemplates, Templates } from '@onlook/constants';
import { Button } from '@onlook/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@onlook/ui/dropdown-menu';
import { Icons } from '@onlook/ui/icons';
import { Input } from '@onlook/ui/input';
import { cn } from '@onlook/ui/utils';
import localforage from 'localforage';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

const RECENT_SEARCHES_KEY = 'onlook_recent_searches';
const RECENT_COLORS_KEY = 'onlook_recent_colors';

interface TopBarProps {
    searchQuery?: string;
    onSearchChange?: (q: string) => void;
}

export const TopBar = ({ searchQuery, onSearchChange }: TopBarProps) => {
    const t = useTranslations();
    const router = useRouter();
    const [isSearchFocused, setIsSearchFocused] = useState(false);
    const [recentSearches, setRecentSearches] = useState<string[]>([]);
    const [recentColors, setRecentColors] = useState<string[]>([]);
    const [isCreatingProject, setIsCreatingProject] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const searchContainerRef = useRef<HTMLDivElement>(null);

    // API hooks
    const { data: user } = api.user.get.useQuery();
    const { mutateAsync: forkSandbox } = api.sandbox.fork.useMutation();
    const { mutateAsync: createLocalSandbox } = api.sandbox.createLocal.useMutation();
    const { mutateAsync: createCfSandbox } = api.cfSandbox.create.useMutation();
    const { mutateAsync: createProject } = api.project.create.useMutation();
    const { setIsAuthModalOpen } = useAuthContext();

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                searchContainerRef.current &&
                !searchContainerRef.current.contains(event.target as Node)
            ) {
                setIsSearchFocused(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Load suggestions from localforage
    useEffect(() => {
        const loadRecentSearches = async () => {
            try {
                const rs = await localforage.getItem<string[]>(RECENT_SEARCHES_KEY) ?? []
                if (Array.isArray(rs)) setRecentSearches(rs.slice(0, 6));
            } catch { }
        };
        loadRecentSearches();
        const loadRecentColors = async () => {
            try {
                const rc = await localforage.getItem<string[]>(RECENT_COLORS_KEY) ?? []
                if (Array.isArray(rc)) setRecentColors(rc.slice(0, 10));
            } catch { }
        };
        loadRecentColors();
    }, []);

    // Persist non-empty search queries to recent
    useEffect(() => {
        const q = (searchQuery ?? '').trim();
        if (!q) return;
        const timer = setTimeout(async () => {
            try {
                const recentSearches = (await localforage.getItem<string[]>(RECENT_SEARCHES_KEY)) ?? []
                const rs = new Set<string>([
                    q,
                    ...recentSearches,
                ]);
                const arr = Array.from(rs).slice(0, 8);
                localforage.setItem(RECENT_SEARCHES_KEY, arr);
                setRecentSearches(arr);
            } catch { }
        }, 600);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setIsSearchFocused(false);
                searchInputRef.current?.blur();
                onSearchChange?.('');
            }
        };

        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('keydown', handleEscape);
        };
    }, [onSearchChange]);

    const handleCreateLocalProject = async (template: 'expo' | 'nextjs') => {
        if (!user?.id) {
            await localforage.setItem(LocalForageKeys.RETURN_URL, window.location.pathname);
            setIsAuthModalOpen(true);
            return;
        }

        setIsCreatingProject(true);
        try {
            toast.info(`Scaffolding ${template === 'expo' ? 'Expo' : 'Next.js'} project locally...`, {
                description: 'This may take a minute',
            });

            const { sandboxId, previewUrl } = await createLocalSandbox({
                template,
                name: 'New Project',
            });

            const newProject = await createProject({
                project: {
                    name: 'New Project',
                    description: `Local ${template} project`,
                    tags: ['local', template],
                },
                sandboxId,
                sandboxUrl: previewUrl,
                userId: user.id,
            });

            if (newProject) {
                router.push(`${Routes.PROJECT}/${newProject.id}`);
            }
        } catch (error) {
            console.error('Error creating local project:', error);
            toast.error('Failed to create local project', {
                description: error instanceof Error ? error.message : String(error),
            });
        } finally {
            setIsCreatingProject(false);
        }
    };

    const handleStartBlankProject = async (template: Templates) => {
        if (!user?.id) {
            // Store the return URL and open auth modal
            await localforage.setItem(LocalForageKeys.RETURN_URL, window.location.pathname);
            setIsAuthModalOpen(true);
            return;
        }

        setIsCreatingProject(true);
        try {
            const isExpo = template === Templates.EXPO_WEB;
            const { sandboxId, previewUrl } = await forkSandbox({
                sandbox: SandboxTemplates[template],
                config: {
                    title: `Blank project - ${user.id}`,
                    tags: ['blank', isExpo ? 'expo' : 'nextjs', user.id],
                },
            });

            const newProject = await createProject({
                project: {
                    name: 'New Project',
                    description: 'Your new blank project',
                    tags: ['blank'],
                },
                sandboxId,
                sandboxUrl: previewUrl,
                userId: user.id,
            });

            if (newProject) {
                router.push(`${Routes.PROJECT}/${newProject.id}`);
            }
        } catch (error) {
            console.error('Error creating blank project:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);

            if (errorMessage.includes('502') || errorMessage.includes('sandbox')) {
                toast.error('Sandbox service temporarily unavailable', {
                    description: 'Please try again in a few moments. Our servers may be experiencing high load.',
                });
            } else {
                toast.error('Failed to create project', {
                    description: errorMessage,
                });
            }
        } finally {
            setIsCreatingProject(false);
        }
    };

    const handleCreateCloudflare = async (template: 'expo' | 'nextjs') => {
        if (!user?.id) {
            await localforage.setItem(LocalForageKeys.RETURN_URL, window.location.pathname);
            setIsAuthModalOpen(true);
            return;
        }

        setIsCreatingProject(true);
        try {
            toast.info(`Creating ${template === 'expo' ? 'Expo' : 'Next.js'} project on Cloudflare...`, {
                description: 'This may take a minute',
            });

            const { sandboxId, previewUrl } = await createCfSandbox({
                template,
                name: 'New Project',
            });

            const newProject = await createProject({
                project: {
                    name: 'New Project',
                    description: `Cloudflare ${template} project`,
                    tags: ['cloudflare', template],
                },
                sandboxId,
                sandboxUrl: previewUrl,
                userId: user.id,
            });

            if (newProject) {
                router.push(`${Routes.PROJECT}/${newProject.id}`);
            }
        } catch (error) {
            console.error('Error creating Cloudflare project:', error);
            toast.error('Failed to create project', {
                description: error instanceof Error ? error.message : String(error),
            });
        } finally {
            setIsCreatingProject(false);
        }
    };

    return (
        <div className="w-full max-w-6xl mx-auto flex items-center justify-between p-4 text-small text-foreground-secondary gap-6">
            <Link href={Routes.HOME} className="flex items-center justify-start mt-0 py-3">
                <Icons.OnlookTextLogo className="w-24" viewBox="0 0 139 17" />
            </Link>

            {typeof onSearchChange === 'function' ? (
                <div className="flex-1 flex justify-center min-w-0">
                    <motion.div
                        ref={searchContainerRef}
                        className="relative w-full hidden sm:block"
                        initial={false}
                        animate={isSearchFocused ?
                            { width: '100%', maxWidth: '360px' } :
                            { width: '100%', maxWidth: '260px' }
                        }
                        transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
                    >
                        <Icons.MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-tertiary z-10" />
                        <Input
                            ref={searchInputRef}
                            value={searchQuery ?? ''}
                            onChange={(e) => onSearchChange?.(e.currentTarget.value)}
                            onFocus={() => setIsSearchFocused(true)}
                            placeholder="Search projects"
                            className="pl-9 pr-7 focus-visible:border-transparent focus-visible:ring-0 w-full"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => onSearchChange?.('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-tertiary hover:text-foreground"
                                aria-label="Clear search"
                            >
                                <Icons.CrossS className="h-4 w-4" />
                            </button>
                        )}
                    </motion.div>
                </div>
            ) : (
                <div className="flex-1" />
            )}

            <div className="flex justify-end gap-3 mt-0 items-center">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            className="text-sm focus:outline-none cursor-pointer py-[0.4rem] h-8"
                            variant="default"
                            disabled={isCreatingProject}
                        >
                            {isCreatingProject ? (
                                <>
                                    Creating... <Icons.LoadingSpinner className="animate-spin" />
                                </>
                            ) : (
                                <>
                                    Create <Icons.ChevronDown />
                                </>
                            )}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent sideOffset={8} className="translate-x-[-12px]">
                        {isProviderEnabled('cloudflare') && (
                            <>
                                <DropdownMenuItem
                                    className={cn(
                                        'focus:bg-orange-100 focus:text-orange-900',
                                        'hover:bg-orange-100 hover:text-orange-900',
                                        'dark:focus:bg-orange-900 dark:focus:text-orange-100',
                                        'dark:hover:bg-orange-900 dark:hover:text-orange-100',
                                        'cursor-pointer select-none group',
                                    )}
                                    onSelect={() => handleCreateCloudflare('nextjs')}
                                    disabled={isCreatingProject}
                                >
                                    {isCreatingProject ? (
                                        <Icons.LoadingSpinner className="w-4 h-4 mr-1 animate-spin text-foreground-secondary group-hover:text-orange-100" />
                                    ) : (
                                        <Icons.FilePlus className="w-4 h-4 mr-1 text-foreground-secondary group-hover:text-orange-100" />
                                    )}
                                    Next.js (Cloud)
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    className={cn(
                                        'focus:bg-orange-100 focus:text-orange-900',
                                        'hover:bg-orange-100 hover:text-orange-900',
                                        'dark:focus:bg-orange-900 dark:focus:text-orange-100',
                                        'dark:hover:bg-orange-900 dark:hover:text-orange-100',
                                        'cursor-pointer select-none group',
                                    )}
                                    onSelect={() => handleCreateCloudflare('expo')}
                                    disabled={isCreatingProject}
                                >
                                    {isCreatingProject ? (
                                        <Icons.LoadingSpinner className="w-4 h-4 mr-1 animate-spin text-foreground-secondary group-hover:text-orange-100" />
                                    ) : (
                                        <Icons.FilePlus className="w-4 h-4 mr-1 text-foreground-secondary group-hover:text-orange-100" />
                                    )}
                                    Expo / RN (Cloud)
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                            </>
                        )}
                        <DropdownMenuItem
                            className={cn(
                                'focus:bg-blue-100 focus:text-blue-900',
                                'hover:bg-blue-100 hover:text-blue-900',
                                'dark:focus:bg-blue-900 dark:focus:text-blue-100',
                                'dark:hover:bg-blue-900 dark:hover:text-blue-100',
                                'cursor-pointer select-none group',
                            )}
                            onSelect={() => handleStartBlankProject(Templates.EMPTY_NEXTJS)}
                            disabled={isCreatingProject}
                        >
                            {isCreatingProject ? (
                                <Icons.LoadingSpinner className="w-4 h-4 mr-1 animate-spin text-foreground-secondary group-hover:text-blue-100" />
                            ) : (
                                <Icons.FilePlus className="w-4 h-4 mr-1 text-foreground-secondary group-hover:text-blue-100" />
                            )}
                            Next.js Project
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            className={cn(
                                'focus:bg-violet-100 focus:text-violet-900',
                                'hover:bg-violet-100 hover:text-violet-900',
                                'dark:focus:bg-violet-900 dark:focus:text-violet-100',
                                'dark:hover:bg-violet-900 dark:hover:text-violet-100',
                                'cursor-pointer select-none group',
                            )}
                            onSelect={() => handleStartBlankProject(Templates.EXPO_WEB)}
                            disabled={isCreatingProject}
                        >
                            {isCreatingProject ? (
                                <Icons.LoadingSpinner className="w-4 h-4 mr-1 animate-spin text-foreground-secondary group-hover:text-violet-100" />
                            ) : (
                                <Icons.FilePlus className="w-4 h-4 mr-1 text-foreground-secondary group-hover:text-violet-100" />
                            )}
                            Expo / React Native
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className={cn(
                                'focus:bg-emerald-100 focus:text-emerald-900',
                                'hover:bg-emerald-100 hover:text-emerald-900',
                                'dark:focus:bg-emerald-900 dark:focus:text-emerald-100',
                                'dark:hover:bg-emerald-900 dark:hover:text-emerald-100',
                                'cursor-pointer select-none group',
                            )}
                            onSelect={() => handleCreateLocalProject('nextjs')}
                            disabled={isCreatingProject}
                        >
                            <Icons.FilePlus className="w-4 h-4 mr-1 text-foreground-secondary group-hover:text-emerald-100" />
                            Next.js (Local)
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            className={cn(
                                'focus:bg-emerald-100 focus:text-emerald-900',
                                'hover:bg-emerald-100 hover:text-emerald-900',
                                'dark:focus:bg-emerald-900 dark:focus:text-emerald-100',
                                'dark:hover:bg-emerald-900 dark:hover:text-emerald-100',
                                'cursor-pointer select-none group',
                            )}
                            onSelect={() => handleCreateLocalProject('expo')}
                            disabled={isCreatingProject}
                        >
                            <Icons.FilePlus className="w-4 h-4 mr-1 text-foreground-secondary group-hover:text-emerald-100" />
                            Expo / React Native (Local)
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className={cn(
                                'focus:bg-teal-100 focus:text-teal-900',
                                'hover:bg-teal-100 hover:text-teal-900',
                                'dark:focus:bg-teal-900 dark:focus:text-teal-100',
                                'dark:hover:bg-teal-900 dark:hover:text-teal-100',
                                'cursor-pointer select-none group',
                            )}
                            onSelect={() => {
                                router.push(Routes.IMPORT_PROJECT);
                            }}
                        >
                            <Icons.Upload className="w-4 h-4 mr-1 text-foreground-secondary group-hover:text-teal-100" />
                            <p className="text-microPlus">{t(transKeys.projects.actions.import)}</p>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                <CurrentUserAvatar className="w-8 h-8" />
            </div>
        </div>
    );
};
