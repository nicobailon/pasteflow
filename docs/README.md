# PasteFlow Documentation

## Overview
PasteFlow is a streamlined productivity tool designed for developers working with AI coding assistants. It allows developers to manage context precisely by packaging their code and instructions in an optimized format for AI interaction.

## Features
- **File Tree Navigation**: Browse directories and files with an expandable tree view, sorting, and refresh capabilities
- **Token Counting**: View the approximate token count for each file (useful for LLM context limits)
- **Search Capabilities**: Quickly find files by name or content
- **Selection Management**: Select multiple files and copy their contents together
- **System Prompts**: Use predefined or custom system prompts to guide AI responses
- **Role Prompts**: Define role-specific instructions for different use cases
- **Workspaces**: Save, restore, and manage application state for different projects or tasks
- **Dark Mode**: Toggle between light and dark themes
- **File Exclusion**: Exclude specific files or patterns from your workspace
- **One-click Copy**: Copy entire code snippets with a single click
- **XML Formatting**: Apply XML changes and copy with XML prompts
- **Cross-platform Path Handling**: Work seamlessly across different operating systems

## Workspaces

Workspaces allow you to save and manage your current application state, including file selections, expanded nodes, instructions, and prompts.

### Saving a Workspace
1. Click the workspace dropdown in the header bar.
2. Select "Save Current Workspace" from the dropdown menu.
3. In the modal, enter a name for your workspace.
4. Click "Save Workspace". If the name exists, confirm to overwrite.
5. The form will clear, allowing you to save additional workspaces without closing the modal.

### Creating a New Workspace
1. Click the workspace dropdown in the header bar.
2. Select "New Workspace" from the dropdown menu.
3. This will clear your current workspace, allowing you to start fresh.

### Managing Workspaces
1. Click the workspace dropdown in the header bar.
2. Select "Manage Workspaces" from the dropdown menu.
3. In the modal, you can:
   - Rename an existing workspace by clicking "Rename" next to it
   - Delete a workspace by clicking "Delete" next to it
   - Load a workspace by clicking "Load" next to it

### Loading a Workspace
1. Click the workspace dropdown in the header bar.
2. Select a workspace from the dropdown list to load it.

### Workspace State
Workspaces save the following information:
- Expanded file tree nodes
- Selected files and line selections
- User instructions
- Token counts for each file
- Selected system and role prompts
- Workspace creation/update timestamp (workspaces are sorted newest first)

## Additional Resources
- See the XML formatting guide for more details on code suggestions: [XMLFormatGuide.md](XMLFormatGuide.md)
- For design information, refer to [design.md](design.md) 