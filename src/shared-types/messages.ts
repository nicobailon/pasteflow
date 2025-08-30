// Shared worker message contracts

// Envelope helper merges type with fields at the top level
export type WorkerEnvelope<TType extends string, TFields = {}> = { type: TType } & TFields;

// Domain types
import type {
  FileData,
  SelectedFileReference,
  Instruction,
  SystemPrompt,
  RolePrompt,
  FileTreeMode,
} from "./index";

// Preview generator messages
export type PreviewChunkMsg = WorkerEnvelope<
  "CHUNK",
  {
    id: string;
    displayChunk?: string;
    fullChunk?: string;
    // Back-compat single-field chunk
    chunk?: string;
    processed: number;
    total: number;
    tokenDelta?: number;
  }
>;

export type PreviewProgressMsg = WorkerEnvelope<
  "PROGRESS",
  { id: string; processed: number; total: number; percent: number; tokenTotal?: number }
>;

export type PreviewCompleteMsg = WorkerEnvelope<
  "COMPLETE",
  {
    id: string;
    finalDisplayChunk?: string;
    finalFullChunk?: string;
    // Back-compat
    finalChunk?: string;
    tokenTotal?: number;
  }
>;

export type PreviewReadyMsg = WorkerEnvelope<"READY">;
export type PreviewInitCompleteMsg = WorkerEnvelope<"INIT_COMPLETE">; // test envs
export type PreviewCancelledMsg = WorkerEnvelope<"CANCELLED", { id: string }>;
export type PreviewErrorMsg = WorkerEnvelope<"ERROR", { id?: string; error: string }>;

export type PreviewWorkerMessage =
  | PreviewChunkMsg
  | PreviewProgressMsg
  | PreviewCompleteMsg
  | PreviewReadyMsg
  | PreviewInitCompleteMsg
  | PreviewCancelledMsg
  | PreviewErrorMsg;

export interface PreviewStartPayload {
  id: string;
  allFiles: FileData[];
  selectedFiles: SelectedFileReference[];
  sortOrder: string;
  fileTreeMode: FileTreeMode;
  selectedFolder: string | null;
  selectedSystemPrompts?: SystemPrompt[];
  selectedRolePrompts?: RolePrompt[];
  selectedInstructions?: Instruction[];
  userInstructions?: string;
  chunkSize?: number; // files per batch
  packOnly?: boolean;
}

// Tree builder messages
export type TreeChunkMsg = WorkerEnvelope<
  "TREE_CHUNK",
  { id: string; payload: { nodes: unknown[]; progress: number } }
>;
export type TreeCompleteMsg = WorkerEnvelope<
  "TREE_COMPLETE",
  { id: string; payload: { nodes: unknown[]; progress: number } }
>;
export type TreeErrorMsg = WorkerEnvelope<
  "TREE_ERROR",
  { id: string; error: string; code?: string }
>;
export type TreeCancelledMsg = WorkerEnvelope<"CANCELLED", { id: string }>;

export type TreeWorkerMessage =
  | TreeChunkMsg
  | TreeCompleteMsg
  | TreeErrorMsg
  | TreeCancelledMsg;

// Selection overlay messages
export type OverlayMessageType = "INIT" | "COMPUTE" | "CANCEL" | "BATCH" | "DONE";

export type OverlayInitMsg = WorkerEnvelope<
  "INIT",
  { payload: { directoryMap: [string, string[]][]; allDirectories: string[] } }
>;
export type OverlayComputeMsg = WorkerEnvelope<
  "COMPUTE",
  { payload: { selectedPaths: string[]; priorityPaths?: string[]; batchSize: number } }
>;
export type OverlayCancelMsg = WorkerEnvelope<"CANCEL">;
export type OverlayBatchMsg = WorkerEnvelope<
  "BATCH",
  { payload: { updates: [string, "f" | "p" | "n"][] } }
>;
export type OverlayDoneMsg = WorkerEnvelope<"DONE">;

export type OverlayWorkerMessage =
  | OverlayInitMsg
  | OverlayComputeMsg
  | OverlayCancelMsg
  | OverlayBatchMsg
  | OverlayDoneMsg;

