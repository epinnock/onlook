'use client';

import { observer } from 'mobx-react-lite';
import { useState } from 'react';

import type { Frame } from '@onlook/models';
import { colors } from '@onlook/ui/tokens';

import { useEditorEngine } from '@/components/store/editor';

import { ResizeHandles } from './resize-handles';
import { SimulatorView } from './simulator-view';
import { TopBar } from './top-bar';
import { RightClickMenu } from '../../right-click-menu';

/**
 * Parallel to the default iframe-based frame shell, rendered when
 * `frame.kind === 'simulator'`. Keeps the top-bar, selection outline, and
 * resize handles so the sim frame feels native on the canvas; swaps the
 * iframe body for <SimulatorView> and drops the Penpal gesture overlay.
 */
export const SimulatorFrameShell = observer(({
    frame,
    isInDragSelection = false,
}: {
    frame: Frame;
    isInDragSelection?: boolean;
}) => {
    const editorEngine = useEditorEngine();
    const [, setIsResizing] = useState(false);
    const isSelected = editorEngine.frames.isSelected(frame.id);

    if (!frame.simulatorSessionId) {
        // Defensive: simulator frames must carry a session id. This shouldn't
        // happen in practice — the ephemeral factory always sets it — but
        // logging beats rendering a blank rectangle.
        // eslint-disable-next-line no-console
        console.warn('[spectra] Simulator frame without simulatorSessionId', frame.id);
    }

    return (
        <div
            className="fixed flex flex-col"
            style={{ transform: `translate(${frame.position.x}px, ${frame.position.y}px)` }}
        >
            <RightClickMenu>
                <TopBar frame={frame} isInDragSelection={isInDragSelection} />
            </RightClickMenu>
            <div
                className="relative"
                style={{
                    outline: isSelected
                        ? `2px solid ${colors.teal[400]}`
                        : isInDragSelection
                            ? `2px solid ${colors.teal[500]}`
                            : 'none',
                    borderRadius: '4px',
                }}
            >
                <ResizeHandles frame={frame} setIsResizing={setIsResizing} />
                {frame.simulatorSessionId && (
                    <SimulatorView
                        sessionId={frame.simulatorSessionId}
                        width={frame.dimension.width}
                        height={frame.dimension.height}
                    />
                )}
            </div>
        </div>
    );
});
