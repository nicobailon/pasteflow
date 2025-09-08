import { EventEmitter } from "node:events";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";

type Session = {
  id: string;
  pid: number;
  proc?: ChildProcessWithoutNullStreams;
  pty?: any;
  buffer: Buffer[];
  bufferBytes: number;
  cursor: number; // logical cursor in aggregated stream
  cwd: string;
  cols: number;
  rows: number;
  createdAt: number;
  name: string;
};

export type TerminalSessionMeta = {
  id: string;
  pid: number;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: number;
  name: string;
};

export type OutputChunk = { chunk: string; nextCursor: number; truncated: boolean };

export class TerminalManager extends EventEmitter {
  private sessions = new Map<string, Session>();
  private maxBufferBytes = 4 * 1024 * 1024; // 4MB ring
  private hasPty: boolean | null = null;

  constructor() {
    super();
  }

  private makeId(): string { return Math.random().toString(36).slice(2, 10); }

  private defaultShell(): { command: string; args: string[] } {
    if (process.platform === 'win32') return { command: process.env.COMSPEC || 'powershell.exe', args: [] };
    const sh = process.env.SHELL || '/bin/bash';
    return { command: sh, args: ['-l'] };
  }

  create(opts: { command?: string; args?: string[]; cwd?: string; cols?: number; rows?: number; env?: Record<string,string> }): { id: string; pid: number } {
    const id = this.makeId();
    const { command, args } = opts.command ? { command: opts.command, args: opts.args ?? [] } : this.defaultShell();
    const cols = Math.max(20, Math.floor(opts.cols ?? 80));
    const rows = Math.max(5, Math.floor(opts.rows ?? 24));
    const env = { ...process.env, ...(opts.env || {}) } as Record<string, string>;
    const cwd = opts.cwd || process.cwd();

    const session: Session = {
      id,
      pid: -1,
      buffer: [],
      bufferBytes: 0,
      cursor: 0,
      cwd,
      cols,
      rows,
      createdAt: Date.now(),
      name: `${command} ${args?.join(' ')}`.trim() || 'shell',
    };

    const handleData = (buf: Buffer | string) => {
      const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'utf8');
      session.buffer.push(data);
      session.bufferBytes += data.length;
      session.cursor += data.length;
      while (session.bufferBytes > this.maxBufferBytes && session.buffer.length > 0) {
        const first = session.buffer.shift()!;
        session.bufferBytes -= first.length;
      }
      try { this.emit('data', id, data.toString('utf8')); } catch { /* noop */ }
    };

    // Try node-pty first (if installed); fallback to child_process
    try {
      if (this.hasPty !== false) {
        const ptyMod = require('node-pty');
        this.hasPty = true;
        const shell = command;
        const pty = ptyMod.spawn(shell, args, { cols, rows, cwd, env });
        session.pty = pty;
        session.pid = typeof pty.pid === 'number' ? pty.pid : -1;
        pty.onData((d: string) => handleData(d));
        pty.onExit(() => { session.pid = -1; });
        this.sessions.set(id, session);
        return { id, pid: session.pid };
      }
    } catch {
      this.hasPty = false;
      // fall through
    }

    const proc = spawn(command, args, { cwd, env, shell: false });
    session.proc = proc;
    session.pid = proc.pid ?? -1;
    proc.stdout.on('data', (d) => handleData(d as Buffer));
    proc.stderr.on('data', (d) => handleData(d as Buffer));
    proc.on('exit', () => { session.pid = -1; });
    this.sessions.set(id, session);
    return { id, pid: session.pid };
  }

  write(id: string, data: string): void {
    const s = this.sessions.get(id);
    if (!s) throw new Error('NOT_FOUND');
    // Prefer PTY write when available; fallback to child_process stdin
    try {
      if (s.pty && typeof s.pty.write === 'function') {
        s.pty.write(data);
        return;
      }
    } catch { /* ignore */ }
    try { s.proc?.stdin?.write?.(data); } catch { /* ignore */ }
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id);
    if (!s) throw new Error('NOT_FOUND');
    s.cols = Math.max(20, Math.floor(cols));
    s.rows = Math.max(5, Math.floor(rows));
    try { s.pty?.resize?.(s.cols, s.rows); } catch { /* ignore if not pty */ }
  }

  kill(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    try { s.pty?.kill?.(); } catch {}
    try { s.proc?.kill?.('SIGTERM'); } catch { /* ignore */ }
    this.sessions.delete(id);
  }

  list(): TerminalSessionMeta[] {
    return Array.from(this.sessions.values()).map((s) => ({ id: s.id, pid: s.pid, cwd: s.cwd, cols: s.cols, rows: s.rows, createdAt: s.createdAt, name: s.name }));
  }

  getOutput(id: string, opts?: { fromCursor?: number; maxBytes?: number }): OutputChunk {
    const s = this.sessions.get(id);
    if (!s) throw new Error('NOT_FOUND');
    const cur = opts?.fromCursor ?? 0;
    const max = Math.min(256 * 1024, Math.max(1024, Math.floor(opts?.maxBytes ?? 64 * 1024)));
    // Concatenate buffer
    const buf = Buffer.concat(s.buffer);
    const total = s.cursor;
    const have = buf.length;
    // Map logical cursor to slice
    const start = Math.max(0, have - (total - cur));
    const slice = buf.subarray(start, Math.min(buf.length, start + max));
    const nextCursor = Math.min(total, cur + slice.length);
    const truncated = slice.length >= max;
    return { chunk: slice.toString('utf8'), nextCursor, truncated };
  }
}
