import type { Request, Response } from 'express';

import { DatabaseBridge } from './db/database-bridge';
import { RendererPreviewProxy } from './preview-proxy';
import { PreviewController } from './preview-controller';
import * as Workspaces from './handlers/workspaces-handlers';
import * as Instructions from './handlers/instructions-handlers';
import * as SystemPrompts from './handlers/system-prompts-handlers';
import * as RolePrompts from './handlers/role-prompts-handlers';
import * as UserInstructions from './handlers/user-instructions-handlers';
import * as Prefs from './handlers/prefs-handlers';
import * as Files from './handlers/files-handlers';
import * as Tokens from './handlers/tokens-handlers';
import * as Folders from './handlers/folders-handlers';
export { selectionBody, exportBody, previewStartBody, previewIdParam } from './handlers/schemas';

export class APIRouteHandlers {
  private readonly logger?: Pick<typeof console, 'log' | 'warn' | 'error'>;

  constructor(
    private readonly db: DatabaseBridge,
    private readonly previewProxy: RendererPreviewProxy,
    private readonly previewController: PreviewController,
    options?: {
      logger?: Pick<typeof console, 'log' | 'warn' | 'error'>;
    }
  ) {
    this.logger = options?.logger;
  }

  // Health and Status
  async handleHealth(req: Request, res: Response) {
    return Workspaces.handleHealth({ db: this.db }, req, res);
  }

  async handleStatus(req: Request, res: Response) {
    return Workspaces.handleStatus({ db: this.db }, req, res);
  }

  // Workspaces
  async handleListWorkspaces(req: Request, res: Response) {
    return Workspaces.handleListWorkspaces({ db: this.db }, req, res);
  }

  async handleCreateWorkspace(req: Request, res: Response) {
    return Workspaces.handleCreateWorkspace({ db: this.db }, req, res);
  }

  async handleGetWorkspace(req: Request, res: Response) {
    return Workspaces.handleGetWorkspace({ db: this.db }, req, res);
  }

  async handleUpdateWorkspace(req: Request, res: Response) {
    return Workspaces.handleUpdateWorkspace({ db: this.db }, req, res);
  }

  async handleDeleteWorkspace(req: Request, res: Response) {
    return Workspaces.handleDeleteWorkspace({ db: this.db }, req, res);
  }

  async handleRenameWorkspace(req: Request, res: Response) {
    return Workspaces.handleRenameWorkspace({ db: this.db }, req, res);
  }

  async handleLoadWorkspace(req: Request, res: Response) {
    return Workspaces.handleLoadWorkspace({ db: this.db }, req, res);
  }

  // Instructions
  async handleListInstructions(req: Request, res: Response) {
    return Instructions.handleListInstructions({ db: this.db }, req, res);
  }

  async handleCreateInstruction(req: Request, res: Response) {
    return Instructions.handleCreateInstruction({ db: this.db }, req, res);
  }

  async handleUpdateInstruction(req: Request, res: Response) {
    return Instructions.handleUpdateInstruction({ db: this.db }, req, res);
  }

  async handleDeleteInstruction(req: Request, res: Response) {
    return Instructions.handleDeleteInstruction({ db: this.db }, req, res);
  }

  // System Prompts
  async handleListSystemPrompts(req: Request, res: Response) {
    return SystemPrompts.handleListSystemPrompts({ db: this.db }, req, res);
  }

  async handleCreateSystemPrompt(req: Request, res: Response) {
    return SystemPrompts.handleCreateSystemPrompt({ db: this.db }, req, res);
  }

  async handleUpdateSystemPrompt(req: Request, res: Response) {
    return SystemPrompts.handleUpdateSystemPrompt({ db: this.db }, req, res);
  }

  async handleDeleteSystemPrompt(req: Request, res: Response) {
    return SystemPrompts.handleDeleteSystemPrompt({ db: this.db }, req, res);
  }

  // Role Prompts
  async handleListRolePrompts(req: Request, res: Response) {
    return RolePrompts.handleListRolePrompts({ db: this.db }, req, res);
  }

  async handleCreateRolePrompt(req: Request, res: Response) {
    return RolePrompts.handleCreateRolePrompt({ db: this.db }, req, res);
  }

  async handleUpdateRolePrompt(req: Request, res: Response) {
    return RolePrompts.handleUpdateRolePrompt({ db: this.db }, req, res);
  }

  async handleDeleteRolePrompt(req: Request, res: Response) {
    return RolePrompts.handleDeleteRolePrompt({ db: this.db }, req, res);
  }

  // User Instructions
  async handleGetUserInstructions(req: Request, res: Response) {
    return UserInstructions.handleGetUserInstructions({ db: this.db }, req, res);
  }

  async handleSetUserInstructions(req: Request, res: Response) {
    return UserInstructions.handleSetUserInstructions({ db: this.db }, req, res);
  }

  // Preferences
  async handleGetPreference(req: Request, res: Response) {
    return Prefs.handleGetPreference({ db: this.db }, req, res);
  }

  async handleSetPreference(req: Request, res: Response) {
    return Prefs.handleSetPreference({ db: this.db }, req, res);
  }

  // Files
  async handleFileInfo(req: Request, res: Response) {
    return Files.handleFileInfo({ db: this.db }, req, res);
  }

  async handleFileContent(req: Request, res: Response) {
    return Files.handleFileContent({ db: this.db }, req, res);
  }

  // Tokens
  async handleCountTokens(req: Request, res: Response) {
    return Tokens.handleCountTokens(req, res);
  }

  async handleGetTokenBackend(req: Request, res: Response) {
    return Tokens.handleGetTokenBackend(req, res);
  }

  // Folders
  async handleGetCurrentFolder(req: Request, res: Response) {
    return Folders.handleGetCurrentFolder({ db: this.db }, req, res);
  }

  async handleOpenFolder(req: Request, res: Response) {
    return Folders.handleOpenFolder({ db: this.db }, req, res);
  }

}
