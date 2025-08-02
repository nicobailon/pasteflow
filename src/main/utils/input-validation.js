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
  folderPath: { type: 'string', required: true, minLength: 1 },
  state: { type: 'object', required: false }
};

const WorkspaceLoadSchema = {
  id: { type: 'string', required: true, minLength: 1 }  // Can be UUID or name
};

const WorkspaceUpdateSchema = {
  id: { type: 'string', required: false, minLength: 1 },  // Can be UUID or name
  name: { type: 'string', required: false, minLength: 1, maxLength: 255 },
  folderPath: { type: 'string', required: false, minLength: 1 },
  state: { type: 'object', required: false }
};

const WorkspaceDeleteSchema = {
  name: { type: 'string', required: true, minLength: 1 }
};

const WorkspaceRenameSchema = {
  oldName: { type: 'string', required: true, minLength: 1, maxLength: 255 },
  newName: { type: 'string', required: true, minLength: 1, maxLength: 255 }
};

const WorkspaceTouchSchema = {
  id: { type: 'string', required: false, minLength: 1 },  // Can be UUID or name
  name: { type: 'string', required: false, minLength: 1 }
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
  filePath: { type: 'string', required: true, minLength: 1 }
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
  FileContentRequestSchema
};