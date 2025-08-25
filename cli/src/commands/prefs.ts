import { createClient, discover, handleAxiosError, parseAtFile, parseJsonValue, printJsonOrText } from "../client";

export function attachPrefsCommand(root: any): void {
  const cmd = root.command("prefs").description("Get/Set preferences");

  // get
  cmd
    .command("get")
    .argument("<key>", "Preference key")
    .description("Get a preference value")
    .action(async (key: string) => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.get(`/api/v1/prefs/${encodeURIComponent(key)}`);
        const data = (res.data?.data ?? res.data) as unknown;

        if (flags.json) {
          printJsonOrText(data, flags);
          process.exit(0);
        }

        // eslint-disable-next-line no-console
        console.log(typeof data === "string" ? data : JSON.stringify(data));
        process.exit(0);
      } catch (err) {
        const mapped = handleAxiosError(err, flags);
        if (flags.json && mapped.json) printJsonOrText(mapped.json, flags);
        else if (mapped.message) {
          // eslint-disable-next-line no-console
          console.error(mapped.message);
        }
        process.exit(mapped.exitCode);
      }
    });

  // set
  cmd
    .command("set")
    .argument("<key>", "Preference key")
    .option("--value <jsonOr@file>", "Value as JSON or @file (omit for null)")
    .description("Set a preference value")
    .action(async (key: string, opts: { value?: string }) => {
      const flags = root.opts() as any;
      try {
        const raw = parseAtFile(opts.value);
        const parsed = raw !== undefined ? parseJsonValue(raw) : null;

        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.put(`/api/v1/prefs/${encodeURIComponent(key)}`, { value: parsed });

        const ok = (res.data?.data ?? res.data) as boolean;
        if (flags.json) {
          printJsonOrText({ ok }, flags);
          process.exit(0);
        }

        // eslint-disable-next-line no-console
        console.log(ok ? "true" : "false");
        process.exit(0);
      } catch (err) {
        const mapped = handleAxiosError(err, flags);
        if (flags.json && mapped.json) printJsonOrText(mapped.json, flags);
        else if (mapped.message) {
          // eslint-disable-next-line no-console
          console.error(mapped.message);
        }
        process.exit(mapped.exitCode);
      }
    });
}