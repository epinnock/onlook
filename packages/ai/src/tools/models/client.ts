import type { EditorEngineLike as EditorEngine } from '../types/editor-engine';
import { BaseTool } from './base';

export abstract class ClientTool extends BaseTool {
    /**
     * Handle the tool execution on the client side
     */
    abstract handle(input: object, editorEngine: EditorEngine): Promise<unknown>;
}