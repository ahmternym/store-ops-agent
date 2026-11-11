import { query, type CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { loadConfig } from './config.js';
import { decide, SERVER } from './policy.js';
import { SYSTEM_PROMPT, TASK_PROMPT } from './prompt.js';
import { buildSdkServer } from './sdkServer.js';
import { createTools } from './tools.js';

let logFile = '';
const log = (event: Record<string, unknown>) => {
  const line = JSON.stringify({ t: new Date().toISOString(), ...event });
  if (logFile) appendFileSync(logFile, line + '\n');
};

const cfg = loadConfig(log);
logFile = cfg.logFile;
mkdirSync(path.dirname(logFile), { recursive: true });

const tools = createTools(cfg.ctx);

/** Asks a person before anything leaves the machine. Without a terminal (CI) the answer is no. */
const canUseTool: CanUseTool = async (toolName, input) => {
  const d = decide(toolName, { dryRun: cfg.ctx.dryRun, autoApprove: cfg.autoApprove });
  log({ permission: toolName, decision: d.behavior });
  if (d.behavior === 'allow') return { behavior: 'allow', updatedInput: input };
  if (d.behavior === 'deny') return { behavior: 'deny', message: d.message };
  if (!process.stdin.isTTY) return { behavior: 'deny', message: 'No one is here to approve this. Mention it in the report instead.' };

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\n--- Approval needed: ${toolName} ---\n${JSON.stringify(input, null, 2)}`);
  const answer = (await rl.question('Allow? [y/N] ')).trim().toLowerCase();
  rl.close();
  return answer === 'y'
    ? { behavior: 'allow', updatedInput: input }
    : { behavior: 'deny', message: 'The maintainer declined this action. Note it in the report.' };
};

console.log(
  `Store Ops: countries=${cfg.ctx.countries.join(',')} dryRun=${cfg.ctx.dryRun} maxTurns=${cfg.maxTurns} budget=$${cfg.maxBudgetUsd}`
);

const run = query({
  prompt: TASK_PROMPT,
  options: {
    systemPrompt: SYSTEM_PROMPT,
    model: cfg.model,
    mcpServers: { [SERVER]: buildSdkServer(tools) },
    tools: [], // no shell, no file edits, no web: only our own tools
    canUseTool, // every tool call goes through the policy in policy.ts and is logged
    maxTurns: cfg.maxTurns,
    maxBudgetUsd: cfg.maxBudgetUsd,
    settingSources: [], // ignore any local Claude Code settings / CLAUDE.md
    persistSession: false
  }
});

try {
  for await (const msg of run) {
    if (msg.type === 'assistant') {
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text.trim()) console.log(`\n${block.text.trim()}`);
        if (block.type === 'tool_use') {
          console.log(`→ ${block.name.replace(`mcp__${SERVER}__`, '')}`);
          log({ tool_use: block.name, input: block.input });
        }
      }
    } else if (msg.type === 'result') {
      const summary = {
        result: msg.subtype,
        turns: msg.num_turns,
        cost_usd: Number(msg.total_cost_usd.toFixed(4)),
        denied: msg.permission_denials.length
      };
      log(summary);
      console.log(`\nDone: ${JSON.stringify(summary)}\nLog: ${path.relative(process.cwd(), logFile)}`);
      if (msg.subtype !== 'success') process.exitCode = 1;
    }
  }
} catch (e) {
  // The SDK also throws after an error result (turn or budget limit); the summary above is already logged
  log({ error: String((e as Error).message).slice(0, 300) });
  if (!process.exitCode) {
    console.error(`Agent stopped: ${(e as Error).message.slice(0, 300)}`);
    process.exitCode = 1;
  }
}
