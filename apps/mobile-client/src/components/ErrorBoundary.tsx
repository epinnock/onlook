/**
 * ErrorBoundary — MC5.6 of plans/onlook-mobile-client-task-queue.md.
 *
 * React class component that catches render-time errors thrown by child
 * components (user bundles). Must be a class component because React only
 * supports error boundaries via `getDerivedStateFromError` / `componentDidCatch`
 * on class components.
 *
 * In error state it renders the existing ErrorScreen (MC3.17) with the
 * captured error message and component stack, plus a Retry button that
 * resets the boundary. Callers may supply a custom `fallback` ReactNode
 * or an `onError` callback for external error reporting.
 */

import React from 'react';
import ErrorScreen from '../screens/ErrorScreen';

const LOG_PREFIX = '[onlook-runtime]';

interface ErrorBoundaryProps {
    children: React.ReactNode;
    /** Optional custom fallback UI rendered instead of ErrorScreen. */
    fallback?: React.ReactNode;
    /** Optional callback invoked when an error is caught (for external reporting). */
    onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
    componentStack: string | null;
}

export default class ErrorBoundary extends React.Component<
    ErrorBoundaryProps,
    ErrorBoundaryState
> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            componentStack: null,
        };
    }

    static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
        return { hasError: true, error };
    }

    override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        const stack = errorInfo.componentStack ?? null;

        // eslint-disable-next-line no-console
        console.error(
            `${LOG_PREFIX} Uncaught render error:`,
            error,
            stack ? `\nComponent stack:${stack}` : '',
        );

        this.setState({ componentStack: stack });

        this.props.onError?.(error, errorInfo);
    }

    private readonly handleRetry = (): void => {
        this.setState({ hasError: false, error: null, componentStack: null });
    };

    override render(): React.ReactNode {
        if (this.state.hasError) {
            // If the caller supplied a custom fallback, use it instead of ErrorScreen.
            if (this.props.fallback !== undefined) {
                return this.props.fallback;
            }

            return (
                <ErrorScreen
                    title="Something went wrong"
                    message={this.state.error?.message ?? 'An unknown error occurred'}
                    details={this.state.componentStack ?? undefined}
                    onRetry={this.handleRetry}
                />
            );
        }

        return this.props.children;
    }
}
