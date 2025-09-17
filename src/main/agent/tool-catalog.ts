export type ToolCatalogAction = {
  name: string;
  required: string[];
  optional?: string[];
  gatedBy?: string;
};

export type ToolCatalogEntry = {
  name: string;
  description: string;
  actions?: ToolCatalogAction[];
};

export function getToolCatalog(): readonly ToolCatalogEntry[] {
  return [
    {
      name: 'file',
      description: 'File operations within the workspace (read/info/list; writes are gated by approval and settings).',
      actions: [
        { name: 'read', required: ['path'], optional: ['lines'] },
        { name: 'info', required: ['path'] },
        { name: 'list', required: ['directory'], optional: ['recursive', 'maxResults'] },
        { name: 'write', required: ['path', 'content'], gatedBy: 'ENABLE_FILE_WRITE/APPROVAL_MODE' },
        { name: 'move', required: ['from', 'to'], gatedBy: 'ENABLE_FILE_WRITE/APPROVAL_MODE' },
        { name: 'delete', required: ['path'], gatedBy: 'ENABLE_FILE_WRITE/APPROVAL_MODE' },
      ],
    },
    {
      name: 'search',
      description: 'Ripgrep-powered code search returning JSON matches, safe and workspace-scoped.',
      actions: [
        { name: 'code', required: ['query'], optional: ['directory', 'maxResults'] },
        { name: 'files', required: ['pattern'], optional: ['directory', 'recursive', 'maxResults'] },
      ],
    },
    {
      name: 'edit',
      description: 'Editing utilities: unified diff preview/apply, targeted block replacement, and multi-file batch. Writes gated by approval.',
      actions: [
        { name: 'diff', required: ['path', 'diff'], optional: ['apply'] },
        { name: 'block', required: ['path', 'search'], optional: ['replacement', 'occurrence', 'isRegex', 'preview', 'apply'] },
        { name: 'multi', required: ['paths', 'search'], optional: ['replacement', 'occurrencePolicy', 'index', 'maxFiles', 'apply'] },
      ],
    },
    {
      name: 'context',
      description: 'Context utilities over the dual-context envelope (summary, expand file contents/lines, search, and tools catalog).',
      actions: [
        { name: 'summary', required: ['envelope'] },
        { name: 'expand', required: ['files'], optional: ['maxBytes'] },
        { name: 'search', required: ['query'], optional: ['directory', 'maxResults'] },
        { name: 'tools', required: [] },
      ],
    },
    {
      name: 'terminal',
      description: 'Terminal control (start/interact/output/list/kill). Execution gated by settings and approvals.',
      actions: [
        { name: 'start', required: ['command'], optional: ['args', 'cwd'] },
        { name: 'interact', required: ['sessionId', 'input'] },
        { name: 'output', required: ['sessionId'], optional: ['cursor', 'maxBytes'] },
        { name: 'list', required: [] },
        { name: 'kill', required: ['sessionId'] },
      ],
    },
  ] as const;
}
