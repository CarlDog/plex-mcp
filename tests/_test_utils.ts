// Shared test double for tool-registration tests (annotation + naming
// enforcement, MCP-T01/MCP-T02). Captures every server.registerTool(...)
// call made by registerTools(server, plex) without needing a real MCP
// transport or a live Plex connection — registration never invokes a
// tool's handler, only records its shape.

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
}

export class CaptureServer {
  tools: CapturedTool[] = [];

  // The real McpServer.registerTool also takes a handler as a third
  // argument; it's omitted here since registration never invokes it and
  // JS doesn't enforce call-site arity, so callers passing one is harmless.
  registerTool(name: string, config: CapturedToolConfig): void {
    this.tools.push({ name, config });
  }
}
