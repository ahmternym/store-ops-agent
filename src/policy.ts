/**
 * Permission policy for the agent run. The model can only reach the five store-ops tools;
 * built-in tools (shell, file edits, web) are switched off entirely.
 * Anything that leaves the machine (a real GitHub issue) needs a yes from a person.
 */
export const SERVER = 'store_ops';
export const mcpName = (tool: string) => `mcp__${SERVER}__${tool}`;

export const READ_TOOLS = ['get_reviews'];
export const LOCAL_WRITE_TOOLS = ['save_reply_draft', 'mark_reviewed', 'write_report'];
export const EXTERNAL_TOOLS = ['create_issue'];

export type Decision = { behavior: 'allow' } | { behavior: 'ask' } | { behavior: 'deny'; message: string };

export function decide(toolName: string, opts: { dryRun: boolean; autoApprove: boolean }): Decision {
  const short = toolName.startsWith(`mcp__${SERVER}__`) ? toolName.slice(`mcp__${SERVER}__`.length) : null;
  if (!short) return { behavior: 'deny', message: `${toolName} is not available to this agent.` };
  if (READ_TOOLS.includes(short) || LOCAL_WRITE_TOOLS.includes(short)) return { behavior: 'allow' };
  if (EXTERNAL_TOOLS.includes(short)) {
    if (opts.dryRun || opts.autoApprove) return { behavior: 'allow' };
    return { behavior: 'ask' };
  }
  return { behavior: 'deny', message: `Unknown tool ${short}.` };
}
