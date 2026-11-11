import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { callTool, toolDefs, type ToolName } from './schema.js';
import { createTools } from './tools.js';

/**
 * The same five tools as a standalone MCP server, so Claude Code, Claude Desktop or any MCP client can use them:
 *   claude mcp add store-ops -- npx tsx /path/to/store-ops-agent/src/mcp-stdio.ts
 * In this mode the client asks the user before each tool call; dry-run still applies to GitHub.
 */
const cfg = loadConfig((e) => console.error(JSON.stringify(e))); // stdout belongs to the MCP protocol
const tools = createTools(cfg.ctx);
const server = new McpServer({ name: 'store-ops', version: '0.1.0' });

for (const name of Object.keys(toolDefs) as ToolName[]) {
  server.registerTool(
    name,
    { description: toolDefs[name].description, inputSchema: toolDefs[name].shape },
    (args: unknown) => callTool(tools, name, args)
  );
}

await server.connect(new StdioServerTransport());
