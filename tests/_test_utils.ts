// Shared test double for tool-registration tests (annotation + naming
// enforcement, MCP-T01/MCP-T02; destructive-tool gate wiring, MCP-P06).
// Captures every server.registerTool(...) call made by
// registerTools(server, plex, tautulli) without needing a real MCP transport or a
// live Plex connection — registration itself never invokes a tool's
// handler, only records its shape. `handler` is captured too so a wiring
// test can invoke a specific tool directly against a stubbed PlexClient.

export type CapturedHandler = (args: Record<string, unknown>) => unknown;

export interface CapturedToolConfig {
  title?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface CapturedTool {
  name: string;
  config: CapturedToolConfig;
  handler: CapturedHandler;
}

export class CaptureServer {
  tools: CapturedTool[] = [];

  registerTool(
    name: string,
    config: CapturedToolConfig,
    handler: CapturedHandler,
  ): void {
    this.tools.push({ name, config, handler });
  }
}
