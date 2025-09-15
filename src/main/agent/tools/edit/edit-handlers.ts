import { readTextFile, validateAndResolvePath, writeTextFile } from "../../../file-service";
import { BINARY_FILE_MSG } from "../shared/constants";
import { clipText, charDiff, contextLines } from "../shared/text-utils";
import type { BaseToolFactoryDeps } from "../shared/tool-factory-types";

import { applyUnifiedDiffSafe, findAllOccurrences, replaceByPolicy } from "./diff-utils";

type RecordFn = (args: unknown, result: unknown) => Promise<unknown>;

type WithDeps = Pick<BaseToolFactoryDeps, "config" | "tokenService">;

export async function handleEditUnified(
  rawParams: any,
  deps: WithDeps,
  record: RecordFn
) {
  const { path, diff, apply } = {
    path: String(rawParams?.path || ""),
    diff: String(rawParams?.diff || ""),
    apply: Boolean(rawParams?.apply),
  } as { path: string; diff: string; apply: boolean };
  const val = validateAndResolvePath(path);
  if (!val.ok) throw new Error(val.message);

  if (!apply) {
    const r = await readTextFile(val.absolutePath);
    if (!r.ok) throw new Error(r.message);
    if (r.isLikelyBinary) throw new Error(BINARY_FILE_MSG);
    const original = r.content;
    const { result: modified, applied, error: applyError } = applyUnifiedDiffSafe(original, diff);
    const [origRes, modRes] = await Promise.all([
      deps.tokenService.countTokens(original),
      deps.tokenService.countTokens(modified),
    ]);
    const originalTokens = origRes.count;
    const modifiedTokens = modRes.count;
    return record(
      { path, diff, apply },
      {
        type: "preview" as const,
        path: val.absolutePath,
        applied,
        error: applyError || undefined,
        diff,
        original: clipText(original, 20_000),
        modified: clipText(modified, 20_000),
        tokenCounts: { original: originalTokens, modified: modifiedTokens },
      }
    );
  }
  if (!deps.config?.ENABLE_FILE_WRITE) {
    return record(
      { path, diff, apply },
      { type: "error" as const, code: "WRITE_DISABLED", message: "File writes disabled" }
    );
  }
  if (deps.config?.APPROVAL_MODE === "always") {
    return record(
      { path, diff, apply },
      { type: "error" as const, code: "APPROVAL_NEEDED", message: "Apply requires approval" }
    );
  }
  const r0 = await readTextFile(val.absolutePath);
  if (!r0.ok) throw new Error(r0.message);
  if (r0.isLikelyBinary) throw new Error(BINARY_FILE_MSG);
  const appliedRes = applyUnifiedDiffSafe(r0.content, diff);
  if (!appliedRes.applied) {
    return record(
      { path, diff, apply },
      { type: "error" as const, code: "APPLY_FAILED", message: appliedRes.error || "Failed to apply diff" }
    );
  }
  const w = await writeTextFile(val.absolutePath, appliedRes.result);
  if (!w.ok) throw new Error(w.message);
  return record({ path, diff, apply }, { type: "applied" as const, path: val.absolutePath, bytes: w.bytes });
}

export async function handleEditBlock(
  rawParams: any,
  deps: WithDeps,
  record: RecordFn
) {
  const path = String(rawParams.path || "");
  const search = String(rawParams.search || "");
  const replacement = typeof rawParams.replacement === "string" ? rawParams.replacement : "";
  const occurrence = Number.isFinite(rawParams.occurrence) ? Math.max(1, Math.floor(rawParams.occurrence)) : 1;
  const isRegex = rawParams.isRegex === true;
  const preview = rawParams.preview !== false;
  const apply = rawParams.apply === true;

  const val = validateAndResolvePath(path);
  if (!val.ok) throw new Error(val.message);
  const r = await readTextFile(val.absolutePath);
  if (!r.ok) throw new Error(r.message);
  if (r.isLikelyBinary) {
    return record(rawParams, { type: "error" as const, code: "BINARY_FILE", message: BINARY_FILE_MSG });
  }

  const original = r.content;
  const occs = findAllOccurrences(original, search, { isRegex });
  const idx = Math.min(Math.max(1, occurrence), Math.max(1, occs.length)) - 1;
  const target = occs[idx];
  if (!target) {
    const res = await deps.tokenService.countTokens(original);
    return record(rawParams, {
      type: "preview" as const,
      path: val.absolutePath,
      occurrencesCount: 0,
      replacedOccurrenceIndex: -1,
      characterDiffs: [],
      contextLines: { before: [], after: [] },
      modified: original,
      tokenCounts: { original: res.count, modified: res.count },
    });
  }

  const before = original.slice(0, target.start);
  const after = original.slice(target.end);
  const modified = before + replacement + after;

  const characterDiffs = charDiff(original, modified);
  const ctx = contextLines(original, { start: target.start, end: target.end }, 3);
  const [origTokRes, modTokRes] = await Promise.all([
    deps.tokenService.countTokens(original),
    deps.tokenService.countTokens(modified),
  ]);
  const origTok = origTokRes.count;
  const modTok = modTokRes.count;

  const previewObj = {
    type: "preview" as const,
    path: val.absolutePath,
    occurrencesCount: occs.length,
    replacedOccurrenceIndex: idx + 1,
    characterDiffs,
    contextLines: ctx,
    modified: clipText(modified),
    tokenCounts: { original: origTok, modified: modTok },
  } as const;

  if (preview || !apply) return record(rawParams, previewObj);
  if (!deps.config?.ENABLE_FILE_WRITE) {
    return record(rawParams, { type: "error" as const, code: "WRITE_DISABLED", message: "File writes are disabled" });
  }
  if (deps.config?.APPROVAL_MODE === "always") {
    return record(rawParams, { type: "error" as const, code: "APPROVAL_NEEDED", message: "Apply requires approval" });
  }
  const w = await writeTextFile(val.absolutePath, modified);
  if (!w.ok) throw new Error(w.message);
  return record(rawParams, { type: "applied" as const, path: val.absolutePath, bytes: w.bytes });
}

export async function handleEditMulti(
  rawParams: any,
  deps: WithDeps,
  record: RecordFn
) {
  const paths = Array.isArray(rawParams.paths) ? rawParams.paths.map(String) : [];
  const search = String(rawParams.search || "");
  const replacement = typeof rawParams.replacement === "string" ? rawParams.replacement : "";
  const isRegex = rawParams.isRegex === true;
  const policy: "first" | "all" | "index" = (
    rawParams.occurrencePolicy === "all" || rawParams.occurrencePolicy === "index"
  )
    ? rawParams.occurrencePolicy
    : "first";
  const index = Number.isFinite(rawParams.index) ? Math.max(1, Math.floor(rawParams.index)) : 1;
  const maxFiles = Number.isFinite(rawParams.maxFiles)
    ? Math.min(200, Math.max(1, Math.floor(rawParams.maxFiles)))
    : 200;

  const canApply =
    deps.config?.ENABLE_FILE_WRITE && deps.config?.APPROVAL_MODE !== "always" && rawParams.apply === true;

  const out: any[] = [];
  let totalReplacements = 0;
  let truncated = false;
  for (const pth of paths) {
    if (out.length >= maxFiles) {
      truncated = true;
      break;
    }
    const val = validateAndResolvePath(pth);
    if (!val.ok) {
      out.push({ path: pth, error: { code: "PATH_DENIED", message: val.message } });
      continue;
    }
    const r = await readTextFile(val.absolutePath);
    if (!r.ok) {
      out.push({ path: val.absolutePath, error: { code: r.code || "FILE_ERROR", message: r.message } });
      continue;
    }
    if (r.isLikelyBinary) {
      out.push({ path: val.absolutePath, error: { code: "BINARY_FILE", message: BINARY_FILE_MSG } });
      continue;
    }

    const original = r.content;
    const occs = findAllOccurrences(original, search, { isRegex });
    if (occs.length === 0) {
      const res = await deps.tokenService.countTokens(original);
      out.push({
        path: val.absolutePath,
        occurrencesCount: 0,
        replacedOccurrenceIndex: -1,
        modified: original,
        characterDiffs: [],
        contextLines: { before: [], after: [] },
        tokenCounts: { original: res.count, modified: res.count },
      });
      continue;
    }

    const rep = replaceByPolicy(original, occs, replacement, policy, index);
    const modified = rep.modified;
    const replacedIndex = rep.replacedIndex;
    totalReplacements += rep.replacements;

    const [origTokResMulti, modTokResMulti] = await Promise.all([
      deps.tokenService.countTokens(original),
      deps.tokenService.countTokens(modified),
    ]);
    const origTok = origTokResMulti.count;
    const modTok = modTokResMulti.count;
    const diffs = charDiff(original, modified);
    const ctx = occs[0] ? contextLines(original, occs[0], 3) : { before: [], after: [] };
    const entry: any = {
      path: val.absolutePath,
      occurrencesCount: occs.length,
      replacedOccurrenceIndex: replacedIndex,
      characterDiffs: diffs,
      contextLines: ctx,
      modified: clipText(modified),
      tokenCounts: { original: origTok, modified: modTok },
    };

    if (canApply) {
      const w = await writeTextFile(val.absolutePath, modified);
      if (!w.ok) {
        entry.error = { code: "WRITE_FAILED", message: w.message };
      }
    }

    out.push(entry);
  }

  const result = { files: out, totalReplacements, truncated, partial: out.length < paths.length };
  return record(rawParams, result);
}
