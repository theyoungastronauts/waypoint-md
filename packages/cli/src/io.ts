/**
 * Injectable I/O so command logic stays testable: commands write through an `IO`
 * rather than touching `console` directly, and tests pass a capturing stub.
 */
export interface IO {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** The default I/O: stdout for logs, stderr for warnings and errors. */
export const consoleIo: IO = {
  log: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

/**
 * A CLI error carrying an exit code. Thrown by command logic; the entry point
 * prints `message` and exits with `exitCode`.
 */
export class CliError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}
