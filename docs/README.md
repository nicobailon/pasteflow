# PasteFlow Documentation

## Overview
PasteFlow is a streamlined productivity tool designed for developers working with AI coding assistants. It allows developers to manage context precisely by packaging their code and instructions in an optimized format for AI interaction.

## Features
- **File Tree Navigation**: Browse directories and files with an expandable tree view
- **Token Counting**: View the approximate token count for each file (useful for LLM context limits)
- **Search Capabilities**: Quickly find files by name or content
- **Selection Management**: Select multiple files and copy their contents together
- **System Prompts**: Use predefined or custom system prompts to guide AI responses
- **Role Prompts**: Define role-specific instructions for different use cases
- **Workspaces**: Save and restore application state for different projects or tasks

## Workspaces

Workspaces allow you to save and manage your current application state, including file selections, expanded nodes, instructions, and prompts.

### Saving a Workspace
1. Click the workspace button (Save icon) in the header bar.
2. Enter a name in the input field.
3. Click "Save Workspace". If the name exists, confirm to overwrite.

### Loading a Workspace
1. Click the workspace button (Save icon) in the header bar.
2. Find your workspace in the list.
3. Click "Load" next to the workspace name.

### Deleting a Workspace
1. Click the workspace button (Save icon) in the header bar.
2. Find your workspace in the list.
3. Click "Delete" next to the workspace name.

### Workspace State
Workspaces save the following information:
- Expanded file tree nodes
- Selected files and line selections
- User instructions
- Token counts for each file
- Selected system and role prompts

## Additional Resources
- See the XML formatting guide for more details on code suggestions: [XMLFormatGuide.md](XMLFormatGuide.md)
- For design information, refer to [design.md](design.md) 