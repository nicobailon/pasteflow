// Input validation schemas for IPC handlers

// Validation helper
function validateInput(schema, input) {
  const errors = [];
  
  // Check if input is valid object
  if (!input || typeof input !== 'object') {
    throw new Error('Validation failed: Invalid input provided');
  }
  
  for (const [key, validator] of Object.entries(schema)) {
    const value = input[key];
    
    if (validator.required && (value === undefined || value === null)) {
      errors.push(`${key} is required`);
      continue;
    }
    
    if (value === undefined || value === null) {
      continue; // Skip optional fields
    }
    
    if (validator.type === 'string' && typeof value !== 'string') {
      errors.push(`${key} must be a string`);
    } else if (validator.type === 'string') {
      if (validator.minLength && value.length < validator.minLength) {
        errors.push(`${key} must be at least ${validator.minLength} characters`);
      }
      if (validator.maxLength && value.length > validator.maxLength) {
        errors.push(`${key} must be at most ${validator.maxLength} characters`);
      }
      if (validator.pattern && !validator.pattern.test(value)) {
        errors.push(`${key} has invalid format`);
      }
    }
    
    if (validator.type === 'object' && typeof value !== 'object') {
      errors.push(`${key} must be an object`);
    }
    
    if (validator.type === 'array' && !Array.isArray(value)) {
      errors.push(`${key} must be an array`);
    } else if (validator.type === 'array') {
      if (validator.maxItems && value.length > validator.maxItems) {
        errors.push(`${key} must have at most ${validator.maxItems} items`);
      }
      if (validator.itemType) {
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          if (validator.itemType === 'string' && typeof item !== 'string') {
            errors.push(`${key}[${i}] must be a string`);
          }
          if (validator.itemType === 'string' && validator.itemMaxLength && item.length > validator.itemMaxLength) {
            errors.push(`${key}[${i}] must be at most ${validator.itemMaxLength} characters`);
          }
        }
      }
    }
  }
  
  if (errors.length > 0) {
    throw new Error(`Validation failed: ${errors.join(', ')}`);
  }
  
  return input;
}

// UUID regex pattern
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Workspace schemas
const WorkspaceCreateSchema = {
  name: { type: 'string', required: true, minLength: 1, maxLength: 255 },
  folderPath: { type: 'string', required: true, minLength: 1, maxLength: 1000 },
  state: { type: 'object', required: false }
};

const WorkspaceLoadSchema = {
  id: { type: 'string', required: true, minLength: 1, maxLength: 255 }  // Can be UUID or name
};

const WorkspaceUpdateSchema = {
  id: { type: 'string', required: false, minLength: 1, maxLength: 255 },  // Can be UUID or name
  name: { type: 'string', required: false, minLength: 1, maxLength: 255 },
  folderPath: { type: 'string', required: false, minLength: 1, maxLength: 1000 },
  state: { type: 'object', required: false }
};

const WorkspaceDeleteSchema = {
  id: { type: 'string', required: true, minLength: 1, maxLength: 255 }  // Can be UUID or name
};

const WorkspaceRenameSchema = {
  oldName: { type: 'string', required: true, minLength: 1, maxLength: 255 },
  newName: { type: 'string', required: true, minLength: 1, maxLength: 255 }
};

const WorkspaceTouchSchema = {
  id: { type: 'string', required: false, minLength: 1, maxLength: 255 },  // Can be UUID or name
  name: { type: 'string', required: false, minLength: 1, maxLength: 255 }
};

// Preferences schemas
const GetPreferenceSchema = {
  key: { type: 'string', required: true, minLength: 1, maxLength: 255 }
};

const SetPreferenceSchema = {
  key: { type: 'string', required: true, minLength: 1, maxLength: 255 },
  value: { type: 'any', required: true } // Value can be any type
};

// File content request schema
const FileContentRequestSchema = {
  filePath: { type: 'string', required: true, minLength: 1, maxLength: 1000 }
};

// Cancel file loading schema
const CancelFileLoadingSchema = {
  requestId: { type: 'string', required: false, maxLength: 255 }
};

// Open docs schema
const OpenDocsSchema = {
  docName: { 
    type: 'string', 
    required: true, 
    minLength: 1, 
    maxLength: 255,
    pattern: /^[a-zA-Z0-9._-]+\.(md|txt|pdf)$/i
  }
};

// Folder selection schema
const FolderSelectionSchema = {
  // This handler has no input parameters but should validate rate limiting
};

// File list request schema
const FileListRequestSchema = {
  folderPath: { type: 'string', required: true, minLength: 1, maxLength: 1000 },
  exclusionPatterns: { 
    type: 'array', 
    required: false, 
    maxItems: 50,
    itemType: 'string',
    itemMaxLength: 200
  },
  requestId: { type: 'string', required: false, maxLength: 255 }
};

// State management schemas
const SaveStateSchema = {
  workspaceId: { type: 'string', required: false, minLength: 1, maxLength: 255 },
  state: { type: 'object', required: true }
};

const LoadStateSchema = {
  workspaceId: { type: 'string', required: false, minLength: 1, maxLength: 255 }
};

const ClearStateSchema = {
  workspaceId: { type: 'string', required: false, minLength: 1, maxLength: 255 }
};

// Settings schemas
const UpdateSettingsSchema = {
  settings: { type: 'object', required: true }
};

const GetSettingsSchema = {
  // No input parameters required
};

module.exports = {
  validateInput,
  WorkspaceCreateSchema,
  WorkspaceLoadSchema,
  WorkspaceUpdateSchema,
  WorkspaceDeleteSchema,
  WorkspaceRenameSchema,
  WorkspaceTouchSchema,
  GetPreferenceSchema,
  SetPreferenceSchema,
  FileContentRequestSchema,
  CancelFileLoadingSchema,
  OpenDocsSchema,
  FolderSelectionSchema,
  FileListRequestSchema,
  SaveStateSchema,
  LoadStateSchema,
  ClearStateSchema,
  UpdateSettingsSchema,
  GetSettingsSchema
};