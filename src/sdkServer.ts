import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { SERVER } from './policy.js';
import { callTool, toolDefs, type ToolName } from './schema.js';
import type { Tools } from './tools.js';

/** The store-ops tools as an in-process MCP server for the Claude Agent SDK. */
export function buildSdkServer(tools: Tools) {
  return createSdkMcpServer({
    name: SERVER,
    version: '0.1.0',
    tools: (Object.keys(toolDefs) as ToolName[]).map((name) =>
      tool(name, toolDefs[name].description, toolDefs[name].shape, (args) => callTool(tools, name, args))
    )
  });
}
