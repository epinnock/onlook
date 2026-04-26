import React from 'react';

/**
 * Class-based error boundary wrapping the overlay element rendered by
 * `OverlayHost` in `App.tsx`. A thrown render/effect error inside an eval'd
 * overlay bundle would otherwise propagate up through `AppRouter` and RedBox
 * the entire mobile client. Catching it here isolates the blast radius — the
 * host app remains interactive and the next overlay push (`renderApp(...)`)
 * can recover.
 *
 * See `plans/adr/v2-pipeline-validation-findings.md` for the pipeline-level
 * decisions that make this boundary necessary.
 */

type Props = {
    children: React.ReactNode;
    /**
     * Called from `componentDidCatch` with the captured error and React's
     * `ErrorInfo` (carrying `componentStack`). The second arg is optional
     * to preserve backward-compatible call signatures — single-arg
     * handlers compile against a wider parameter list.
     */
    onError?: (error: Error, errorInfo?: React.ErrorInfo) => void;
};

type State = { hasError: boolean };

export class OverlayErrorBoundary extends React.Component<Props, State> {
    state: State = { hasError: false };

    static getDerivedStateFromError(): State {
        return { hasError: true };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        this.props.onError?.(error, errorInfo);
    }

    componentDidUpdate(prevProps: Props): void {
        // When the subscriber pushes a new overlay element (new children
        // identity), reset so the fresh tree gets a chance to render.
        if (this.state.hasError && prevProps.children !== this.props.children) {
            this.setState({ hasError: false });
        }
    }

    render(): React.ReactNode {
        if (this.state.hasError) return null;
        return this.props.children;
    }
}
