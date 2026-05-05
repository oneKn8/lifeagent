/**
 * Tiny argv parser. Splits flags `--key=value` and `--key value` from
 * positional args. No external dep.
 */
export interface ParsedArgs {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string | true>;
}

export function parseArgv(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { command: undefined, positional: [], flags: {} };
  let i = 0;
  if (argv[0] && !argv[0].startsWith("--")) {
    out.command = argv[0];
    i = 1;
  }
  while (i < argv.length) {
    const tok = argv[i] ?? "";
    if (tok.startsWith("--")) {
      const stripped = tok.slice(2);
      const eq = stripped.indexOf("=");
      if (eq >= 0) {
        out.flags[stripped.slice(0, eq)] = stripped.slice(eq + 1);
        i += 1;
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          out.flags[stripped] = next;
          i += 2;
        } else {
          out.flags[stripped] = true;
          i += 1;
        }
      }
    } else {
      out.positional.push(tok);
      i += 1;
    }
  }
  return out;
}
