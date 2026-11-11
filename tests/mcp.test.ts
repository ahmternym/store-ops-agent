import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSdkServer } from '../src/sdkServer.js';
import { createTools } from '../src/tools.js';
import { fixtureSource } from '../src/reviews.js';

/** Starts the real stdio MCP server as a child process and talks to it like Claude Code would. */
describe('MCP server (stdio)', () => {
  let client: Client;

  beforeAll(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'store-ops-mcp-'));
    client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('src/mcp-stdio.ts')],
        env: {
          ...(process.env as Record<string, string>),
          REVIEWS_SOURCE: path.resolve('fixtures/synthetic-reviews.json'),
          COUNTRIES: 'all',
          DATA_DIR: path.join(dir, 'data'),
          REPORTS_DIR: path.join(dir, 'reports')
        }
      })
    );
  }, 30000);

  afterAll(async () => client?.close());

  it('lists the five tools with descriptions and schemas', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['create_issue', 'get_reviews', 'mark_reviewed', 'save_reply_draft', 'write_report']);
    const create = tools.find((t) => t.name === 'create_issue')!;
    expect(create.inputSchema.required).toEqual(expect.arrayContaining(['title', 'body', 'labels', 'review_ids']));
  });

  it('runs get_reviews and rejects bad input through the schema', async () => {
    const res = (await client.callTool({ name: 'get_reviews', arguments: { limit: 3 } })) as { content: { text: string }[] };
    expect(JSON.parse(res.content[0].text).count).toBe(3);
    const bad = (await client.callTool({ name: 'create_issue', arguments: { title: 'x' } })) as { isError?: boolean };
    expect(bad.isError).toBe(true);
  });
});

describe('Agent SDK server', () => {
  it('wraps the same tools as an in-process MCP server', () => {
    const tools = createTools({
      source: fixtureSource('fixtures/synthetic-reviews.json'),
      countries: ['all'],
      dataDir: tmpdir(),
      reportsDir: tmpdir(),
      dryRun: true,
      maxIssuesPerRun: 5,
      log: () => {}
    });
    const server = buildSdkServer(tools);
    expect(server.type).toBe('sdk');
    expect(server.name).toBe('store_ops');
  });
});
