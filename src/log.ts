// Structured logger. Writes to stderr in the format:
//   <ISO-timestamp> <LEVEL> [<scope>] <message> key=value key2=value2
//
// Level controlled by LOG_LEVEL env var (default: info). Order:
// trace < debug < info < warn < error.
//
// Always writes to stderr (not stdout) because plex-mcp's stdio
// transport uses stdout for the MCP wire protocol — writing logs
// there corrupts the protocol. Stays on stderr in HTTP mode for
// consistency.

type Level = "trace" | "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<Level, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

const envLevel = (process.env.LOG_LEVEL ?? "info").toLowerCase() as Level;
const minPriority = LEVEL_PRIORITY[envLevel] ?? LEVEL_PRIORITY.info;

function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(meta)) {
    let val: string;
    if (v === null || v === undefined) {
      val = String(v);
    } else if (typeof v === "string") {
      val = /\s/.test(v) ? JSON.stringify(v) : v;
    } else {
      val = JSON.stringify(v);
    }
    parts.push(`${k}=${val}`);
  }
  return parts.length ? " " + parts.join(" ") : "";
}

function emit(
  level: Level,
  scope: string,
  msg: string,
  meta?: Record<string, unknown>,
): void {
  if (LEVEL_PRIORITY[level] < minPriority) return;
  const ts = new Date().toISOString();
  console.error(
    `${ts} ${level.toUpperCase()} [${scope}] ${msg}${formatMeta(meta)}`,
  );
}

export const log = {
  trace: (scope: string, msg: string, meta?: Record<string, unknown>) =>
    emit("trace", scope, msg, meta),
  debug: (scope: string, msg: string, meta?: Record<string, unknown>) =>
    emit("debug", scope, msg, meta),
  info: (scope: string, msg: string, meta?: Record<string, unknown>) =>
    emit("info", scope, msg, meta),
  warn: (scope: string, msg: string, meta?: Record<string, unknown>) =>
    emit("warn", scope, msg, meta),
  error: (scope: string, msg: string, meta?: Record<string, unknown>) =>
    emit("error", scope, msg, meta),
};
