export interface ExecuteCodeInput {
  code: string;
  language?: "python" | "javascript" | "bash";
  /** Hard timeout in seconds. Default 30, max 300. */
  timeout?: number;
  /** Files to seed into the sandbox before running. Path → content. */
  files?: Record<string, string>;
}

export interface ExecuteCodeOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
  /** Files the sandbox created/modified during the run (path → bytes). */
  produced_files: Array<{ path: string; bytes: number; preview?: string }>;
  /** True when the runtime exited cleanly within the timeout. */
  ok: boolean;
}
