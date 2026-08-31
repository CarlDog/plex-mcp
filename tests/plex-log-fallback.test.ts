import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PLEX_PRIMARY_LOG_FILENAME,
  classifyPlexLogFallback,
  readPrimaryPlexLog,
  resolveFallbackLogFilename,
} from "../src/plex.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "plex-log-fallback-"));
  tempDirs.push(dir);
  return dir;
}

describe("classifyPlexLogFallback", () => {
  it("allows Plex 5xx and transport failures only", () => {
    expect(
      classifyPlexLogFallback(new Error("Plex 503 Service Unavailable")),
    ).toBe("plex_http_503");
    expect(
      classifyPlexLogFallback(new Error("fetch failed: ECONNREFUSED")),
    ).toBe("transport_error");
    expect(classifyPlexLogFallback(new Error("request timed out"))).toBe(
      "transport_error",
    );
    expect(
      classifyPlexLogFallback(new Error("Plex 401 Unauthorized")),
    ).toBeNull();
    expect(
      classifyPlexLogFallback(new Error("bundle exceeded size cap")),
    ).toBeNull();
  });
});

describe("resolveFallbackLogFilename", () => {
  it("never writes plain-text fallback bytes under a ZIP name", () => {
    expect(resolveFallbackLogFilename("diagnostics.zip")).toBe(
      "diagnostics.fallback.log",
    );
    expect(resolveFallbackLogFilename("diagnostics.log")).toBe(
      "diagnostics.log",
    );
    expect(resolveFallbackLogFilename(undefined, 123)).toBe(
      "plex-server-log-123.log",
    );
  });
});

describe("readPrimaryPlexLog", () => {
  it("reads only the fixed primary log within the configured cap", () => {
    const dir = tempDir();
    const content = "Plex Media Server diagnostic line\n";
    writeFileSync(join(dir, PLEX_PRIMARY_LOG_FILENAME), content);
    writeFileSync(join(dir, "Plex Transcoder Statistics.log"), "not selected");

    expect(readPrimaryPlexLog(dir, 1024).toString("utf8")).toBe(content);
  });

  it("returns actionable mount errors and enforces the shared size cap", () => {
    const missing = tempDir();
    expect(() => readPrimaryPlexLog(missing, 1024)).toThrow(
      /HOST_PLEX_LOG_SOURCE_DIR/,
    );

    const oversized = tempDir();
    writeFileSync(join(oversized, PLEX_PRIMARY_LOG_FILENAME), "too large");
    expect(() => readPrimaryPlexLog(oversized, 3)).toThrow(
      /MCP_LOG_MAX_BYTES=3/,
    );
  });
});
