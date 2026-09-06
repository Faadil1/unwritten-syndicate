import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * SESSION E2 — authorized real-model route: the already-authenticated
 * Claude Code CLI, invoked non-interactively (`claude -p`) once per
 * prediction, from a neutral temporary working directory, with a brand new
 * process/session every call (never --resume/--continue). See
 * docs/AO_BUILD_LEDGER.md / reports/dev_bakeoff/config.json for the frozen
 * rationale behind each flag below.
 *
 * Isolation flags used (all documented in `claude --help`, CLI v2.1.263):
 *   --tools ""            disable every built-in tool (no Bash/Edit/Read/etc.)
 *   --strict-mcp-config    no MCP servers loaded (no --mcp-config given either)
 *   --setting-sources ""   ignore user/project/local settings (no injected
 *                          CLAUDE.md, hooks, or skills)
 *   --disable-slash-commands  skills cannot be invoked
 *   --permission-prompts none  anything that would still prompt is auto-denied
 *   --no-session-persistence   nothing written to a resumable session store
 * The predictor prompt itself is passed via stdin (not argv) so it can
 * contain arbitrary issue text (quotes, newlines, backticks) with zero shell
 * quoting/injection risk.
 */
export const CLAUDE_CLI_MODEL = "claude-sonnet-5";

export const CLAUDE_CLI_ISOLATION_FLAGS: readonly string[] = [
  "--output-format",
  "json",
  "--model",
  CLAUDE_CLI_MODEL,
  "--tools",
  "",
  "--strict-mcp-config",
  "--setting-sources",
  "",
  "--no-session-persistence",
  "--disable-slash-commands",
  "--permission-prompts",
  "none",
];

const BASH_EXE = "C:\\Program Files\\Git\\usr\\bin\\bash.exe";
const CLI_COMMAND_LINE = `claude -p ${CLAUDE_CLI_ISOLATION_FLAGS.map((f) => (f === "" ? '""' : f)).join(" ")}`;

export function neutralCliCwd(): string {
  const dir = path.join(os.tmpdir(), "unwritten-dev-bakeoff-neutral-cwd");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface ClaudeCliEnvelope {
  readonly result?: string;
  readonly is_error?: boolean;
  readonly subtype?: string;
  readonly duration_ms?: number;
  readonly duration_api_ms?: number;
  readonly total_cost_usd?: number;
  readonly usage?: {
    readonly server_tool_use?: { readonly web_search_requests?: number; readonly web_fetch_requests?: number };
  };
  readonly modelUsage?: Record<string, unknown>;
  readonly subagent_stats?: { readonly spawned?: number };
  readonly session_id?: string;
  readonly num_turns?: number;
  readonly [key: string]: unknown;
}

export interface ClaudeCliCallResult {
  readonly envelope: ClaudeCliEnvelope;
  readonly resultText: string;
  readonly latencyMs: number;
  readonly webSearchRequests: number;
  readonly webFetchRequests: number;
  readonly subagentsSpawned: number;
  readonly totalCostUsd: number;
  readonly modelUsage: Record<string, unknown>;
}

export class ClaudeCliIntegrityViolation extends Error {
  constructor(message: string, readonly envelope: ClaudeCliEnvelope) {
    super(message);
    this.name = "ClaudeCliIntegrityViolation";
  }
}

/**
 * Invokes the authorized Claude Code CLI route exactly once, fresh process,
 * no session resume, prompt delivered via stdin. Rejects on spawn/process
 * failure or non-JSON stdout; throws ClaudeCliIntegrityViolation if the
 * envelope reports any web search, web fetch, or subagent activity (hard
 * lock: DEV inference must never touch the network or spawn subagents).
 */
export function invokeClaudeCliOnce(prompt: string, timeoutMs = 120_000): Promise<ClaudeCliCallResult> {
  const cwd = neutralCliCwd();
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const child = spawn(BASH_EXE, ["-c", CLI_COMMAND_LINE], { cwd, shell: false, timeout: timeoutMs });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => reject(new Error(`claude CLI spawn failed: ${err.message}`)));
    child.on("close", (code, signal) => {
      const latencyMs = Date.now() - start;
      if (signal) {
        reject(new Error(`claude CLI killed by signal ${signal} (timeout=${timeoutMs}ms). stderr: ${stderr.slice(0, 2000)}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`claude CLI exited with code ${code}. stderr: ${stderr.slice(0, 2000)}`));
        return;
      }
      let envelope: ClaudeCliEnvelope;
      try {
        envelope = JSON.parse(stdout) as ClaudeCliEnvelope;
      } catch {
        reject(new Error(`claude CLI stdout was not valid JSON: ${stdout.slice(0, 2000)}`));
        return;
      }
      const webSearchRequests = envelope.usage?.server_tool_use?.web_search_requests ?? 0;
      const webFetchRequests = envelope.usage?.server_tool_use?.web_fetch_requests ?? 0;
      const subagentsSpawned = envelope.subagent_stats?.spawned ?? 0;
      if (webSearchRequests !== 0 || webFetchRequests !== 0 || subagentsSpawned !== 0) {
        reject(
          new ClaudeCliIntegrityViolation(
            `integrity violation: web_search_requests=${webSearchRequests} web_fetch_requests=${webFetchRequests} subagents_spawned=${subagentsSpawned}`,
            envelope,
          ),
        );
        return;
      }
      if (envelope.is_error === true) {
        reject(new Error(`claude CLI reported is_error=true: ${JSON.stringify(envelope).slice(0, 2000)}`));
        return;
      }
      resolve({
        envelope,
        resultText: typeof envelope.result === "string" ? envelope.result : "",
        latencyMs,
        webSearchRequests,
        webFetchRequests,
        subagentsSpawned,
        totalCostUsd: envelope.total_cost_usd ?? 0,
        modelUsage: (envelope.modelUsage as Record<string, unknown>) ?? {},
      });
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}
