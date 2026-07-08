#!/usr/bin/env node
import { createProgram } from "./program";
import { getVersion } from "./version";
import { CliError } from "./io";

async function main(): Promise<void> {
  const program = createProgram(getVersion());
  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  // CliError carries a clean message + exit code; anything else prints its
  // message (network/API errors already read cleanly) without a stack dump.
  if (err instanceof CliError) {
    console.error(err.message);
    process.exitCode = err.exitCode;
    return;
  }
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
