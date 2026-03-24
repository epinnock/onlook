import type { Commands } from './command';
import type { MCPServerConfig } from './mcp';

export interface ProjectSettings {
    commands: Commands;
    mcpServers?: MCPServerConfig[];
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
    commands: {
        build: '',
        run: '',
        install: '',
    },
};
