// Selection Overlay Worker
// Computes directory selection overlay diffs in chunks prioritized by visible/expanded directories.
// Message protocol:
// - INIT:    { type: 'INIT', payload: { directoryMap: [dir: string, files: string[]][], allDirectories: string[] } }
// - COMPUTE: { type: 'COMPUTE', payload: { selectedPaths: string[], priorityPaths?: string[], batchSize: number } }
// - CANCEL:  { type: 'CANCEL' }
// Responses:
// - READY:   { type: 'READY' }
// - BATCH:   { type: 'BATCH', payload: { updates: [dir: string, code: 'f'|'p'|'n'][] } }
// - DONE:    { type: 'DONE' }

type SelectionCode = 'f' | 'p' | 'n';

type InitMsg = {
  type: 'INIT';
  payload: {
    directoryMap: [string, string[]][];
    allDirectories: string[];
  };
};

type ComputeMsg = {
  type: 'COMPUTE';
  payload: {
    selectedPaths: string[];
    priorityPaths?: string[];
    batchSize: number;
  };
};

type CancelMsg = { type: 'CANCEL' };

type InMsg = InitMsg | ComputeMsg | CancelMsg;

interface WorkerState {
  directoryMap: Map<string, string[]>;
  allDirectories: string[];
  currentTaskId: number;
}

const state: WorkerState = {
  directoryMap: new Map(),
  allDirectories: [],
  currentTaskId: 0,
};

function countSelected(filesInDir: string[], selected: Set<string>): number {
  let count = 0;
  for (let i = 0; i < filesInDir.length; i++) {
    if (selected.has(filesInDir[i])) count++;
  }
  return count;
}

function computeDirState(dir: string, selected: Set<string>): SelectionCode {
  const files = state.directoryMap.get(dir) || [];
  if (files.length === 0) return 'n';
  const selectedCount = countSelected(files, selected);
  if (selectedCount === 0) return 'n';
  if (selectedCount === files.length) return 'f';
  return 'p';
}

function pathDepth(p: string): number {
  if (!p) return 0;
  const parts = p.split('/').filter(Boolean);
  return parts.length;
}

function handleInit(msg: InitMsg) {
  state.directoryMap = new Map(msg.payload.directoryMap);
  state.allDirectories = msg.payload.allDirectories;
  // Acknowledge readiness
  (self as unknown as Worker).postMessage({ type: 'READY' });
}

function handleCompute(msg: ComputeMsg) {
  const taskId = ++state.currentTaskId;
  const selected = new Set<string>(msg.payload.selectedPaths);
  const batchSize = Math.max(200, Math.min(msg.payload.batchSize || 1000, 4000));

  // Build prioritization list
  const prioSet = new Set<string>(msg.payload.priorityPaths || []);
  const prioritized: string[] = [
    ...state.allDirectories.filter(d => prioSet.has(d)),
    ...state.allDirectories.filter(d => !prioSet.has(d)).sort((a, b) => pathDepth(a) - pathDepth(b)),
  ];

  let index = 0;

  const run = () => {
    // Cancelled or superseded
    if (taskId !== state.currentTaskId) return;

    const start = index;
    const end = Math.min(index + batchSize, prioritized.length);
    const updates: [string, SelectionCode][] = [];

    for (let i = start; i < end; i++) {
      const dir = prioritized[i];
      const code = computeDirState(dir, selected);
      updates.push([dir, code]);
    }

    if (updates.length > 0) {
      (self as unknown as Worker).postMessage({ type: 'BATCH', payload: { updates } });
    }

    index = end;

    if (index < prioritized.length) {
      // Yield back to event loop
      setTimeout(run, 0);
    } else {
      (self as unknown as Worker).postMessage({ type: 'DONE' });
    }
  };

  run();
}

function handleCancel() {
  // Advance task id so any in-flight compute will retire
  state.currentTaskId++;
}

(self as unknown as Worker).onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'INIT':
      handleInit(msg);
      break;
    case 'COMPUTE':
      handleCompute(msg);
      break;
    case 'CANCEL':
      handleCancel();
      break;
    default:
      // no-op
      break;
  }
};