import { BrowserWindow } from 'electron';
import { STORAGE_KEYS } from '../../constants';

export interface LineRange {
  start: number;
  end: number;
}

export interface ExtractedData {
  workspaces: Record<string, WorkspaceData>;
  prompts: {
    system: PromptData[];
    role: PromptData[];
    active: {
      systemIds: string[];
      roleIds: string[];
    };
  };
  preferences: Record<string, unknown>;
  fileSelections: SelectedFileData[];
  expandedNodes: Record<string, boolean>;
  instructions: InstructionData[];
  recentFolders: string[];
  uiState: Record<string, unknown>;
  rawData: Record<string, string>;
}

interface WorkspaceData {
  selectedFolder: string | null;
  selectedFiles: SelectedFileData[];
  expandedNodes: Record<string, boolean>;
  files: FileData[];
  tokenCount: number;
  userInstructions: string;
  customPrompts: Record<string, unknown>;
  [key: string]: unknown;
}

interface PromptData {
  id: string;
  name: string;
  content: string;
  tokenCount?: number;
  createdAt?: number;
  updatedAt?: number;
}

interface SelectedFileData {
  path: string;
  lines?: LineRange[];
  content?: string;
  tokenCount?: number;
  isFullFile?: boolean;
}

interface FileData {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  isBinary: boolean;
  tokenCount?: number;
  lastModified?: number;
}

interface InstructionData {
  id: string;
  content: string;
  createdAt?: number;
}

export class LocalStorageExtractor {
  static async extractAllData(window: BrowserWindow): Promise<ExtractedData> {
    const rawData = await window.webContents.executeJavaScript(`
      (function() {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          data[key] = localStorage.getItem(key);
        }
        return data;
      })()
    `);

    return this.parseExtractedData(rawData);
  }

  private static parseExtractedData(raw: Record<string, string>): ExtractedData {
    const extracted: ExtractedData = {
      workspaces: {},
      prompts: {
        system: [],
        role: [],
        active: {
          systemIds: [],
          roleIds: []
        }
      },
      preferences: {},
      fileSelections: [],
      expandedNodes: {},
      instructions: [],
      recentFolders: [],
      uiState: {},
      rawData: raw
    };

    if (raw[STORAGE_KEYS.WORKSPACES]) {
      try {
        extracted.workspaces = JSON.parse(raw[STORAGE_KEYS.WORKSPACES]);
      } catch (e) {
        console.error('Failed to parse workspaces:', e);
      }
    }

    if (raw[STORAGE_KEYS.SYSTEM_PROMPTS]) {
      try {
        extracted.prompts.system = JSON.parse(raw[STORAGE_KEYS.SYSTEM_PROMPTS]);
      } catch (e) {
        console.error('Failed to parse system prompts:', e);
      }
    }

    if (raw[STORAGE_KEYS.ROLE_PROMPTS]) {
      try {
        extracted.prompts.role = JSON.parse(raw[STORAGE_KEYS.ROLE_PROMPTS]);
      } catch (e) {
        console.error('Failed to parse role prompts:', e);
      }
    }

    if (raw['pasteflow.active_system_prompts']) {
      try {
        extracted.prompts.active.systemIds = JSON.parse(raw['pasteflow.active_system_prompts']);
      } catch (e) {
        console.error('Failed to parse active system prompts:', e);
      }
    }

    if (raw['pasteflow.active_role_prompts']) {
      try {
        extracted.prompts.active.roleIds = JSON.parse(raw['pasteflow.active_role_prompts']);
      } catch (e) {
        console.error('Failed to parse active role prompts:', e);
      }
    }

    const preferenceKeys = [
      'pasteflow.token_counter_visible',
      STORAGE_KEYS.FILE_TREE_MODE,
      'pasteflow.theme',
      'pasteflow.auto_save',
      STORAGE_KEYS.SORT_ORDER,
      STORAGE_KEYS.FILE_TREE_SORT_ORDER,
      STORAGE_KEYS.WORKSPACE_SORT_MODE
    ];

    preferenceKeys.forEach(key => {
      if (raw[key]) {
        try {
          extracted.preferences[key] = JSON.parse(raw[key]);
        } catch (e) {
          extracted.preferences[key] = raw[key];
        }
      }
    });

    if (raw[STORAGE_KEYS.SELECTED_FILES]) {
      try {
        extracted.fileSelections = JSON.parse(raw[STORAGE_KEYS.SELECTED_FILES]);
      } catch (e) {
        console.error('Failed to parse file selections:', e);
      }
    }

    if (raw[STORAGE_KEYS.EXPANDED_NODES]) {
      try {
        extracted.expandedNodes = JSON.parse(raw[STORAGE_KEYS.EXPANDED_NODES]);
      } catch (e) {
        console.error('Failed to parse expanded nodes:', e);
      }
    }

    if (raw[STORAGE_KEYS.INSTRUCTIONS]) {
      try {
        const instructions = JSON.parse(raw[STORAGE_KEYS.INSTRUCTIONS]);
        extracted.instructions = Array.isArray(instructions) 
          ? instructions 
          : [instructions].filter(Boolean);
      } catch (e) {
        console.error('Failed to parse instructions:', e);
      }
    }

    if (raw['pasteflow.recent_folders']) {
      try {
        extracted.recentFolders = JSON.parse(raw['pasteflow.recent_folders']);
      } catch (e) {
        console.error('Failed to parse recent folders:', e);
      }
    }

    const uiStateKeys = [
      STORAGE_KEYS.CURRENT_WORKSPACE,
      STORAGE_KEYS.SEARCH_TERM,
      STORAGE_KEYS.WORKSPACE_MANUAL_ORDER
    ];

    uiStateKeys.forEach(key => {
      if (raw[key]) {
        try {
          extracted.uiState[key] = JSON.parse(raw[key]);
        } catch (e) {
          extracted.uiState[key] = raw[key];
        }
      }
    });

    return extracted;
  }
}