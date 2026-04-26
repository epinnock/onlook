import { EditorMode, type CodeNavigationTarget } from "@onlook/models";
import { makeAutoObservable } from "mobx";
import type { EditorEngine } from "../engine";

export class IdeManager {
    private _codeNavigationOverride: CodeNavigationTarget | null = null;

    constructor(private readonly editorEngine: EditorEngine) {
        makeAutoObservable(this);
    }

    get codeNavigationOverride() {
        return this._codeNavigationOverride;
    }

    async openCodeBlock(oid: string) {
        try {
            // Get the current branch data
            const activeBranchId = this.editorEngine.branches.activeBranch?.id;
            if (!activeBranchId) {
                console.warn('[IdeManager] No active branch found');
                return;
            }

            const branchData = this.editorEngine.branches.getBranchDataById(activeBranchId);
            if (!branchData) {
                console.warn(`[IdeManager] No branch data found for branchId: ${activeBranchId}`);
                return;
            }

            // Get element metadata
            const metadata = await branchData.codeEditor.getJsxElementMetadata(oid);
            if (!metadata) {
                console.warn(`[IdeManager] No metadata found for OID: ${oid}`);
                return;
            }

            // Create navigation target
            const startLine = metadata.startTag.start.line;
            const startColumn = metadata.startTag.start.column;
            const endTag = metadata.endTag || metadata.startTag;
            const endLine = endTag.end.line;
            const endColumn = endTag.end.column;

            const target: CodeNavigationTarget = {
                filePath: metadata.path,
                range: {
                    start: { line: startLine, column: startColumn },
                    end: { line: endLine, column: endColumn }
                }
            };

            // Set the override to trigger navigation
            this._codeNavigationOverride = target;

            // Switch to code tab
            this.editorEngine.state.editorMode = EditorMode.CODE;
        } catch (error) {
            console.error('[IdeManager] Error opening code block:', error);
        }
    }

    clearCodeNavigationOverride() {
        this._codeNavigationOverride = null;
    }

    hasCodeNavigationOverride(): boolean {
        return this._codeNavigationOverride !== null;
    }

    /**
     * Direct file+line+column navigation — bypasses the OID metadata
     * lookup `openCodeBlock` does because tap-to-source from the phone
     * (MC4.14 → MC4.15 → MC4.17) arrives with the source location
     * already resolved (the phone's runtime injects `__source` at
     * build time and the tap handler reads it). Sets a zero-length
     * range at the supplied position and switches to CODE mode using
     * the same MobX `_codeNavigationOverride` mechanism `openCodeBlock`
     * uses, so the existing `useCodeNavigation` hook
     * (`code-tab/hooks/use-code-navigation.ts`) drives the CodeMirror
     * EditorView to scroll-into-view + place the cursor.
     *
     * Lines + columns are 1-indexed to match the wire shape from
     * `OnlookSelectMessage` and the existing `metadata.startTag.start`
     * shape in {@link openCodeBlock}.
     */
    openCodeLocation(fileName: string, lineNumber: number, columnNumber: number): void {
        if (!fileName || lineNumber <= 0 || columnNumber < 0) {
            console.warn(
                '[IdeManager] openCodeLocation: invalid args',
                { fileName, lineNumber, columnNumber },
            );
            return;
        }
        this._codeNavigationOverride = {
            filePath: fileName,
            range: {
                start: { line: lineNumber, column: columnNumber },
                end: { line: lineNumber, column: columnNumber },
            },
        };
        this.editorEngine.state.editorMode = EditorMode.CODE;
    }
}