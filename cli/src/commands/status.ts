import { createClient, discover, handleAxiosError, printJsonOrText, formatAsTable } from "../client";

export function attachStatusCommand(root: any): void {
  root
    .command("status")
    .description("Show server status, active workspace, and allowed paths")
    .option("--include-selection", "Show selected files with token counts", false)
    .action(async (opts: { includeSelection?: boolean }) => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.get("/api/v1/status");
        const data = (res.data?.data ?? res.data) as {
          status: string;
          activeWorkspace: { id: string; name: string; folderPath: string } | null;
          securityContext: { allowedPaths: string[] };
        };

        // Best-effort extras: fileTreeMode, selection counts and tokens
        let fileTreeMode: string | null = null;
        let selectedFilesCount = 0;
        let fileTokens = 0;
        let selectionFilesRows: Array<{ path: string; ranges: string; tokens: string; note: string; type?: string }> | null = null;
        let selectionError: { code: string; message: string } | null = null;

        try {
          const wsId = data.activeWorkspace?.id;
          if (wsId) {
            const ws = await client.get(`/api/v1/workspaces/${encodeURIComponent(wsId)}`);
            const wdata = (ws.data?.data ?? ws.data) as { state?: { fileTreeMode?: string } };
            fileTreeMode = String(wdata?.state?.fileTreeMode || 'selected');
          }
        } catch {
          // ignore
        }

        try {
          const selRes = await client.get('/api/v1/files/selected');
          const sel = (selRes.data?.data ?? selRes.data) as Array<{ path: string; lines?: { start: number; end: number }[] }>;
          selectedFilesCount = Array.isArray(sel) ? sel.length : 0;
        } catch (err) {
          // On NO_ACTIVE_WORKSPACE or others, show zero
          selectedFilesCount = 0;
        }

        try {
          const tokRes = await client.get('/api/v1/selection/tokens');
          const tokData = (tokRes.data?.data ?? tokRes.data) as {
            files: Array<{ path: string; ranges: { start: number; end: number }[] | null; tokenCount: number; skipped: boolean; reason: string | null }>;
            totals: { files: number };
          };
          fileTokens = tokData?.totals?.files || 0;
          if (opts.includeSelection) {
            const fmtRanges = (ranges: { start: number; end: number }[] | null | undefined) => {
              if (!ranges || ranges.length === 0) return "(all)";
              return ranges.map(r => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`)).join(",");
            };
            selectionFilesRows = tokData.files.map((f) => ({
              type: 'File',
              path: f.path,
              ranges: fmtRanges(f.ranges),
              tokens: String(f.tokenCount),
              note: f.skipped ? `skipped: ${f.reason || ''}` : '',
            }));
          }
        } catch (err) {
          const mapped = handleAxiosError(err, { ...flags, json: true } as any);
          const payload = (mapped.json as any) || { error: { code: 'UNKNOWN', message: 'Failed to fetch selection summary' } };
          selectionError = payload.error || null;
          fileTokens = 0;
          selectionFilesRows = opts.includeSelection ? [] : null;
        }

        if (flags.json) {
          const payload = {
            ...data,
            fileTreeMode: fileTreeMode ?? 'n/a',
            selectionSummary: {
              selectedFiles: selectedFilesCount,
              fileTokens,
              ...(opts.includeSelection ? { files: selectionFilesRows ?? [] } : {}),
              ...(selectionError ? { error: selectionError } : {}),
            }
          };
          printJsonOrText(payload, flags);
          process.exit(0);
        }

        const lines: string[] = [];
        lines.push(`Server: ${data.status} (${d.baseURL})`);
        if (data.activeWorkspace) {
          lines.push(
            `Active Workspace: ${data.activeWorkspace.name} [${data.activeWorkspace.id}]`, `Folder: ${data.activeWorkspace.folderPath}`
          );
        } else {
          lines.push("Active Workspace: none");
        }
        lines.push(`File Tree Mode: ${fileTreeMode ?? 'n/a'}`);
        lines.push(`Selected Files: ${selectedFilesCount}`);
        lines.push(`Tokens (Selected Files): ${fileTokens}`);
        const allowed = data.securityContext?.allowedPaths ?? [];
        if (allowed.length > 0) {
          lines.push("Allowed Paths:");
          for (const p of allowed) lines.push(`  - ${p}`);
        } else {
          lines.push("Allowed Paths: (none)", 
            "Hint: run 'pasteflow folders open --folder /abs/path' or 'pasteflow workspaces load <id>'",
          );
        }

        console.log(lines.join("\n"));
        if (opts.includeSelection && selectionFilesRows && selectionFilesRows.length > 0) {
          const table = formatAsTable(selectionFilesRows, [
            { key: 'type', header: 'Type' },
            { key: 'path', header: 'Path/Name' },
            { key: 'ranges', header: 'Ranges' },
            { key: 'tokens', header: 'Tokens' },
            { key: 'note', header: 'Note' },
          ]);
          console.log("\n" + table);
        }
        process.exit(0);
      } catch (error) {
        const mapped = handleAxiosError(error, flags);
        if (flags.json && mapped.json) printJsonOrText(mapped.json, flags);
        else if (mapped.message) {
           
          console.error(mapped.message);
        }
        process.exit(mapped.exitCode);
      }
    });
}
