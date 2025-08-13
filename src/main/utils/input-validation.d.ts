export interface ValidationSchema {
  [key: string]: {
    type: 'string' | 'object' | 'array' | 'any';
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    maxItems?: number;
    itemType?: string;
    itemMaxLength?: number;
  };
}

export function validateInput<T = any>(schema: ValidationSchema, input: unknown): T;

export const WorkspaceCreateSchema: ValidationSchema;
export const WorkspaceLoadSchema: ValidationSchema;
export const WorkspaceExistsSchema: ValidationSchema;
export const WorkspaceUpdateSchema: ValidationSchema;
export const WorkspaceDeleteSchema: ValidationSchema;
export const WorkspaceRenameSchema: ValidationSchema;
export const WorkspaceTouchSchema: ValidationSchema;
export const GetPreferenceSchema: ValidationSchema;
export const SetPreferenceSchema: ValidationSchema;
export const FileContentRequestSchema: ValidationSchema;
export const CancelFileLoadingSchema: ValidationSchema;
export const OpenDocsSchema: ValidationSchema;
export const FolderSelectionSchema: ValidationSchema;
export const FileListRequestSchema: ValidationSchema;
export const SaveStateSchema: ValidationSchema;
export const LoadStateSchema: ValidationSchema;
export const ClearStateSchema: ValidationSchema;
export const UpdateSettingsSchema: ValidationSchema;
export const GetSettingsSchema: ValidationSchema;