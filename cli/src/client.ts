import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import axios, { AxiosError, AxiosInstance } from "axios";

export type ExitCode =
  | 0  // Success
  | 1  // General/server error
  | 2  // Validation or path denied
  | 3  // Auth error
  | 4  // Not found
  | 5  // Conflict/binary
  | 6; // Server not running/unreachable

export interface GlobalFlags {
  host?: string;
  port?: number;
  token?: string;
  json?: boolean;
  timeout?: number;
  raw?: boolean;
  debug?: boolean;
}

export interface Discovery {
  host: string;
  port: number;
  token: string;
  baseURL: string;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_TIMEOUT = 10_000;

export async function discover(flags: GlobalFlags): Promise<Discovery> {
  const host = flags.host || process.env.PASTEFLOW_HOST || DEFAULT_HOST;
  const port =
    flags.port ||
    toInt(process.env.PASTEFLOW_PORT) ||
    readPortFile() ||
    5839; // best-effort default if file missing (may be wrong)
  const token =
    flags.token ||
    process.env.PASTEFLOW_TOKEN ||
    readTokenFile() ||
    "";

  const baseURL = `http://${host}:${port}`;
  return { host, port, token, baseURL };
}

export function createClient(d: Discovery, flags: GlobalFlags): AxiosInstance {
  const timeout = typeof flags.timeout === "number" && flags.timeout > 0 ? flags.timeout : DEFAULT_TIMEOUT;
  const instance = axios.create({
    baseURL: d.baseURL,
    timeout,
    headers: {
      Authorization: `Bearer ${d.token}`,
      "Content-Type": "application/json"
    }
  });

  if (flags.debug) {
    instance.interceptors.request.use((config) => {
       
      console.error("[pf][http] >>", config.method?.toUpperCase(), config.baseURL + (config.url || ""), {
        headers: config.headers,
        timeout: config.timeout
      });
      return config;
    });
    instance.interceptors.response.use(
      (res) => {
         
        console.error("[pf][http] <<", res.status, res.config.url);
        return res;
      },
      (err) => {
         
        console.error("[pf][http] !!", (err as AxiosError)?.code, (err as AxiosError)?.message);
        return Promise.reject(err);
      }
    );
  }

  return instance;
}

export function formatAsTable<T extends Record<string, unknown>>(rows: T[], columns: { key: keyof T; header: string }[]): string {
  if (rows.length === 0) return "";
  const widths = columns.map((c) => Math.max(c.header.length, ...rows.map((r) => String(r[c.key] ?? "").length)));
  const header = columns.map((c, i) => pad(String(c.header), widths[i])).join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  const body = rows.map((r) => columns.map((c, i) => pad(String(r[c.key] ?? ""), widths[i])).join("  ")).join("\n");
  return header + "\n" + sep + "\n" + body;
}

export function parseAtFile(value?: string): string | undefined {
  if (!value) return value;
  if (value.startsWith("@")) {
    const filePath = value.slice(1);
    return fs.readFileSync(filePath, "utf8");
  }
  return value;
}

export async function parseAtFileAsync(value?: string): Promise<string | undefined> {
  if (!value) return value;
  if (value.startsWith("@")) {
    const filePath = value.slice(1);
    return await fs.promises.readFile(filePath, "utf8");
  }
  return value;
}

export function parseJsonValue(input?: string): unknown {
  if (!input) return undefined;
  try {
    return JSON.parse(input);
  } catch {
    throw new Error("Invalid JSON provided");
  }
}

export function handleAxiosError(err: unknown, flags: GlobalFlags): { exitCode: ExitCode; message?: string; json?: unknown } {
  const ax = err as AxiosError;
  // Connection / server not running
  if (ax.code === "ECONNREFUSED" || ax.code === "ENETUNREACH" || ax.code === "ECONNRESET" || ax.message?.includes("timeout")) {
    const message = "Server not running or unreachable. Start the app and ensure server.port is correct (try: npm run dev:electron).";
    return flags.json ? { exitCode: 6, json: { error: { code: "UNREACHABLE", message } } } : { exitCode: 6, message };
  }

  const status = ax.response?.status || 0;
  const data = ax.response?.data as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | undefined;
  const code = data?.error?.code;
  const message = data?.error?.message || ax.message || "Unknown error";

  const mapByCode: Record<string, ExitCode> = {
    UNAUTHORIZED: 3,
    VALIDATION_ERROR: 2,
    NO_ACTIVE_WORKSPACE: 2,
    PATH_DENIED: 2,
    FILE_NOT_FOUND: 4,
    WORKSPACE_NOT_FOUND: 4,
    BINARY_FILE: 5,
    CONFLICT: 5,
    FILE_SYSTEM_ERROR: 1,
    DB_OPERATION_FAILED: 1,
    INTERNAL_ERROR: 1,
    PREVIEW_TIMEOUT: 1
  };

  let exitCode: ExitCode = 1;
  if (code && mapByCode[code] !== undefined) {
    exitCode = mapByCode[code];
  } else {
    // Fallback by HTTP status
    switch (status) {
    case 401: {
    exitCode = 3;
    break;
    }
    case 400: 
    case 403: {
    exitCode = 2;
    break;
    }
    case 404: {
    exitCode = 4;
    break;
    }
    case 409: {
    exitCode = 5;
    break;
    }
    case 0: {
    exitCode = 6;
    break;
    }
    default: { exitCode = 1;
    }
    }
  }

  if (flags.json) {
    return { exitCode, json: data || { error: { code: code || "UNKNOWN", message } } };
  }
  return { exitCode, message: `${code ? code + ": " : ""}${message}` };
}

export function printJsonOrText(payload: unknown, flags: GlobalFlags, fallbackText?: string): void {
  if (flags.json) {
     
    console.log(JSON.stringify(payload, null, 2));
  } else if (typeof fallbackText === "string") {
     
    console.log(fallbackText);
  } else {
     
    console.log(payload);
  }
}

function readPortFile(): number | null {
  try {
    const p = path.join(os.homedir(), ".pasteflow", "server.port");
    const txt = fs.readFileSync(p, "utf8").trim();
    const n = Number.parseInt(txt, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function readTokenFile(): string | null {
  try {
    const p = path.join(os.homedir(), ".pasteflow", "auth.token");
    return fs.readFileSync(p, "utf8").trim();
  } catch {
    return null;
  }
}

function toInt(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s;
  return s + " ".repeat(width - s.length);
}