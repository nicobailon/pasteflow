┌──────────────────────────────────────────────────────────────────────────────────────┐
│                               PASTEFLOW AGENT ARCHITECTURE                            │
└──────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                  RENDERER PROCESS                                    │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                       │
│  ┌────────────────────────┐        ┌──────────────────────────────────────┐        │
│  │   Chat UI Components   │        │  Agent Approvals UI Components        │        │
│  │  - Message Display     │◄───────┤  - AgentApprovalList                 │        │
│  │  - User Input          │        │  - AgentApprovalCard                 │        │
│  │  - Streaming Display   │        │  - DiffPreview / TerminalOutputView  │        │
│  └─────────┬──────────────┘        │  - EditApprovalModal                 │        │
│            │                        │  - ToolApprovalStrip                 │        │
│            │                        └────────┬─────────────────────────────┘        │
│            │                                 │                                       │
│            │                        ┌────────▼──────────────────┐                   │
│            │                        │  useAgentApprovals Hook   │                   │
│            │                        │  - State management        │                   │
│            │                        │  - Event watchers          │                   │
│            │                        │  - Action handlers         │                   │
│            │                        └────────┬──────────────────┘                   │
│            │                                 │                                       │
└────────────┼─────────────────────────────────┼───────────────────────────────────────┘
             │                                 │
             │ HTTP POST /chat                 │ IPC: approvals.*
             │ (streamText response)           │ (list, apply, reject, cancel)
             │                                 │
┌────────────▼─────────────────────────────────▼───────────────────────────────────────┐
│                                   MAIN PROCESS                                        │
├───────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                       │
│  ┌──────────────────────────────────────────────────────────────────────────┐       │
│  │                         API SERVER / IPC LAYER                            │       │
│  │  ┌────────────────────┐              ┌────────────────────┐              │       │
│  │  │  chat-handlers.ts  │              │  approvals-ipc.ts  │              │       │
│  │  │  - handleChat()    │              │  - handleApprovalList            │       │
│  │  │  - Message routing │              │  - handleApprovalApply           │       │
│  │  │  - Context parsing │              │  - handleApprovalReject          │       │
│  │  └──────────┬─────────┘              └────────┬───────────┘              │       │
│  └─────────────┼────────────────────────────────┼──────────────────────────┘       │
│                │                                 │                                   │
│                │                                 │                                   │
│    ┌───────────▼────────────────────────────────▼────────────────────┐             │
│    │                    ORCHESTRATION LAYER                           │             │
│    │  ┌──────────────────────────────────────────────────────────┐   │             │
│    │  │  Chat Handler Orchestration                              │   │             │
│    │  │  • Resolve config via resolveAgentConfig()               │   │             │
│    │  │  • Initialize security manager                            │   │             │
│    │  │  • Compose system prompt via composeEffectiveSystemPrompt│   │             │
│    │  │  • Get enabled tools via getEnabledToolsSet()            │   │             │
│    │  │  • Create tools via getAgentTools()                      │   │             │
│    │  │  • Call AI provider via streamText()                     │   │             │
│    │  │  • Register tool execution callback                       │   │             │
│    │  └──────────────────────────────────────────────────────────┘   │             │
│    └──────────────────────────────┬──────────────────────────────────┘             │
│                                   │                                                 │
│  ┌────────────────────────────────┼───────────────────────────────────────┐        │
│  │         AGENT CORE MODULES     │                                       │        │
│  ├────────────────────────────────┼───────────────────────────────────────┤        │
│  │                                │                                       │        │
│  │  ┌──────────────────┐   ┌──────▼──────────┐   ┌────────────────────┐ │        │
│  │  │  config.ts       │   │  system-prompt  │   │ model-resolver.ts  │ │        │
│  │  │  • Provider      │   │  • Build prompt │   │ • Load credentials │ │        │
│  │  │  • Model         │   │  • Tool guidance│   │ • Resolve provider │ │        │
│  │  │  • Token limits  │   │  • Exec context │   │ • Create AI model  │ │        │
│  │  │  • Prefs + env   │   └─────────────────┘   └────────────────────┘ │        │
│  │  └──────────────────┘                                                 │        │
│  │                                                                        │        │
│  │  ┌──────────────────┐   ┌─────────────────┐   ┌────────────────────┐ │        │
│  │  │ security-manager │   │  tools-config   │   │  pricing.ts        │ │        │
│  │  │ • Path validation│   │  • Enable/disable│   │  • Cost tracking   │ │        │
│  │  │  • Allowed paths │   │    per tool      │   │  • Token pricing   │ │        │
│  │  └──────────────────┘   └─────────────────┘   └────────────────────┘ │        │
│  │                                                                        │        │
│  └────────────────────────────────────────────────────────────────────────┘        │
│                                                                                     │
│  ┌───────────────────────────────────────────────────────────────────────┐        │
│  │                           TOOLS LAYER                                 │        │
│  ├───────────────────────────────────────────────────────────────────────┤        │
│  │  ┌───────────────────────────────────────────────────────────────┐   │        │
│  │  │  tools.ts - getAgentTools()                                   │   │        │
│  │  │  • Creates tool instances with deps                            │   │        │
│  │  │  • Wires signal, security, config, sessionId                   │   │        │
│  │  └───────────────┬───────────────────────────────────────────────┘   │        │
│  │                  │                                                     │        │
│  │     ┌────────────┼────────────┬──────────────┬──────────────┐         │        │
│  │     │            │            │              │              │         │        │
│  │  ┌──▼──────┐ ┌──▼──────┐ ┌───▼───────┐ ┌───▼────────┐ ┌───▼──────┐  │        │
│  │  │ file    │ │ edit    │ │ terminal  │ │ search     │ │ context  │  │        │
│  │  │ -tool   │ │ -tool   │ │ -tool     │ │ -tool      │ │ -tool    │  │        │
│  │  │         │ │         │ │           │ │            │ │          │  │        │
│  │  │ Read    │ │ Diff    │ │ Run       │ │ Grep       │ │ Code     │  │        │
│  │  │ Write   │ │ Block   │ │ commands  │ │ Find files │ │ analysis │  │        │
│  │  │ List    │ │ Multi   │ │ Cancel    │ │ Fast ctx   │ │ Semantic │  │        │
│  │  └─────────┘ └─────────┘ └───────────┘ └────────────┘ └──────────┘  │        │
│  │       │           │            │              │             │         │        │
│  └───────┼───────────┼────────────┼──────────────┼─────────────┼─────────┘        │
│          │           │            │              │             │                  │
│          └───────────┴────────────┴──────────────┴─────────────┘                  │
│                                   │                                               │
│                      ┌─────────────▼──────────────────────────┐                   │
│                      │  Tool Execution Returns Result         │                   │
│                      │  • Success: result data                 │                   │
│                      │  • Preview: { type: "preview", ... }    │                   │
│                      └─────────────┬──────────────────────────┘                   │
│                                    │                                               │
│                      ┌─────────────▼───────────────────────────────┐              │
│                      │  onToolExecute Callback in chat-handlers    │              │
│                      │  1. Log execution to DB (insertToolExecution)│              │
│                      │  2. Capture preview if result is preview     │              │
│                      └─────────────┬───────────────────────────────┘              │
│                                    │                                               │
│  ┌─────────────────────────────────▼───────────────────────────────────────┐     │
│  │                       APPROVALS SERVICE LAYER                            │     │
│  ├──────────────────────────────────────────────────────────────────────────┤     │
│  │  ┌──────────────────────────────────────────────────────────────────┐   │     │
│  │  │  approvals-service.ts - ApprovalsService                         │   │     │
│  │  │  • recordPreview() - persist preview to DB                        │   │     │
│  │  │  • createApproval() - create pending approval record              │   │     │
│  │  │  • evaluateAutoPolicy() - check auto-approve rules                │   │     │
│  │  │  • trackAutoApply() - enforce auto-approve cap                    │   │     │
│  │  │  • applyApproval() - execute tool action with args                │   │     │
│  │  │  • rejectApproval() - mark rejected + feedback                    │   │     │
│  │  │  • cancelPreview() - kill terminal sessions                       │   │     │
│  │  │  • listApprovals() - query pending/auto_approved                  │   │     │
│  │  │  • EventEmitter for real-time updates                             │   │     │
│  │  └──────────────────────────────────────────────────────────────────┘   │     │
│  │           │                                                               │     │
│  │           ├──► preview-capture.ts - capturePreviewIfAny()                │     │
│  │           │    • Extract preview from tool result                         │     │
│  │           │    • Derive action, summary, detail                           │     │
│  │           │    • Coordinate with approvals service                        │     │
│  │           │                                                               │     │
│  │           ├──► preview-registry.ts                                        │     │
│  │           │    • Type definitions (PreviewId, ChatSessionId, ToolName)    │     │
│  │           │    • Preview envelope structure                               │     │
│  │           │    • Hashing utilities                                        │     │
│  │           │                                                               │     │
│  │           └──► approvals-telemetry.ts - logApprovalEvent()               │     │
│  │                • Log approval lifecycle events                            │     │
│  │                                                                           │     │
│  └───────────────────────────────────────────────────────────────────────────┘     │
│                                   │                                                │
│  ┌────────────────────────────────▼──────────────────────────────────────┐        │
│  │                        DATABASE BRIDGE                                │        │
│  ├───────────────────────────────────────────────────────────────────────┤        │
│  │  database-bridge.ts                                                   │        │
│  │  • insertToolExecution() / insertToolExecutionReturningId()           │        │
│  │  • insertPreview() / getPreviewById()                                 │        │
│  │  • insertApproval() / updateApprovalStatus()                          │        │
│  │  • updateApprovalFeedback()                                           │        │
│  │  • listApprovalsBySession()                                           │        │
│  │  • getPreference() / setPreference()                                  │        │
│  │  • SQLite persistent storage                                          │        │
│  └───────────────────────────────────────────────────────────────────────┘        │
│                                                                                    │
└────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────┐
│                               EXTERNAL INTEGRATIONS                                 │
├────────────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────────────────┐  │
│  │  AI Providers    │   │  File System     │   │  Terminal Manager            │  │
│  │  • OpenAI        │   │  • Read/Write    │   │  • Execute commands          │  │
│  │  • Anthropic     │   │  • Directory ops │   │  • Session management        │  │
│  │  • OpenRouter    │   │  • Gitignore     │   │  • Output streaming          │  │
│  │  • Groq          │   │  • Path security │   │  • Process cancellation      │  │
│  └──────────────────┘   └──────────────────┘   └──────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────┐
│                                 DATA FLOW EXAMPLE                                   │
├────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  1. User sends message → React UI → POST /chat → chat-handlers.ts                  │
│  2. Handler resolves config, security, tools, composes system prompt               │
│  3. streamText() called with AI provider, tools attached                            │
│  4. AI requests tool execution → tool executes → returns result                     │
│  5. If result.type === "preview": capturePreviewIfAny() triggered                  │
│  6. Preview recorded → Approval created → Auto-policy evaluated                     │
│  7. If not auto-approved: UI notified via EventEmitter → IPC bridge                │
│  8. useAgentApprovals() updates state → AgentApprovalCard renders                  │
│  9. User clicks Approve → IPC call → applyApproval() → Tool re-executed            │
│ 10. Result stored → Approval status updated → UI updated via watch events          │
│                                                                                     │
└────────────────────────────────────────────────────────────────────────────────────┘

KEY ARCHITECTURAL PATTERNS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Config-First Design: All agent behavior configurable via prefs + env
- Security-by-Default: Path validation, allowed workspaces, approval gates
- Tool Preview System: Risky actions return preview → approval flow → execution
- Event-Driven Approvals: Real-time updates via EventEmitter → IPC → React hooks
- Modular Tool Architecture: Each tool is a factory with deps injection
- Database-Backed State: All approvals, previews, executions persisted
- Multi-Provider Support: Abstract model resolution for OpenAI/Anthropic/etc
- Auto-Approval Policies: Configurable per-tool bypass with session caps