import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { decide, mcpName } from '../src/policy.js';
import { fixtureSource, parseAppStoreFeed } from '../src/reviews.js';
import { callTool } from '../src/schema.js';
import { createTools, sanitize, type ToolContext } from '../src/tools.js';

const SYNTHETIC = path.resolve('fixtures/synthetic-reviews.json');

async function setup(extra: Partial<ToolContext> = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'store-ops-'));
  const ctx: ToolContext = {
    source: fixtureSource(SYNTHETIC),
    countries: ['all'],
    dataDir: path.join(dir, 'data'),
    reportsDir: path.join(dir, 'reports'),
    dryRun: true,
    maxIssuesPerRun: 5,
    log: () => {},
    ...extra
  };
  return { ctx, tools: createTools(ctx), dir };
}

describe('App Store feed parsing', () => {
  it('parses the real Turkish feed of Smart Slide', async () => {
    const json = JSON.parse(await readFile('fixtures/appstore-tr.json', 'utf8'));
    const reviews = parseAppStoreFeed(json, 'tr');
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toMatchObject({ id: '14713695319', rating: 5, version: '1.16', country: 'tr' });
  });

  it('handles a single review (object, not array) and an empty feed', () => {
    const one = { feed: { entry: { id: { label: 'x' }, 'im:rating': { label: '3' }, content: { label: 'ok' } } } };
    expect(parseAppStoreFeed(one, 'us')).toHaveLength(1);
    expect(parseAppStoreFeed({ feed: {} }, 'us')).toEqual([]);
  });
});

describe('tools', () => {
  it('returns only new reviews and remembers what was marked', async () => {
    const { tools } = await setup();
    const first = await tools.get_reviews({});
    expect(first.count).toBe(6);
    await tools.mark_reviewed({ review_ids: ['syn-001', 'syn-002'] });
    expect((await tools.get_reviews({})).count).toBe(4);
    expect((await tools.get_reviews({ only_new: false })).count).toBe(6);
  });

  it('refuses ids it never showed to the model', async () => {
    const { tools } = await setup();
    const res = await callTool(tools, 'create_issue', { title: 'Made up', body: 'x'.repeat(30), labels: ['bug'], review_ids: ['nope'] });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Unknown review id/);
  });

  it('files an issue in dry-run, never twice for the same reviews', async () => {
    const { tools } = await setup();
    await tools.get_reviews({});
    const args = { title: 'Level 37 does not unlock the next level', body: 'Users report the level stays locked.', labels: ['bug'], review_ids: ['syn-001'] };
    const a = await tools.create_issue(args);
    expect(a).toMatchObject({ created: true, dryRun: true });
    const b = await tools.create_issue({ ...args, title: 'Same thing again' });
    expect(b).toMatchObject({ created: false });
  });

  it('caps issues per run and drops unknown labels', async () => {
    const { tools } = await setup({ maxIssuesPerRun: 1 });
    await tools.get_reviews({});
    const a = await tools.create_issue({ title: 'Black screen on iPad', body: 'Stuck on launch on iPadOS 26.1', labels: ['crash', 'urgent' as 'bug'], review_ids: ['syn-003'] });
    expect((a as { issue: { labels: string[] } }).issue.labels).toEqual(['crash']);
    await expect(tools.create_issue({ title: 'Ads too often', body: 'An ad after every level', labels: ['ads'], review_ids: ['syn-002'] })).rejects.toThrow(/limit/);
  });

  it('posts to GitHub only outside dry-run, and breaks @mentions', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ html_url: 'https://github.com/o/r/issues/1' }), { status: 201 }));
    const { tools } = await setup({ dryRun: false, github: { repo: 'o/r', token: 't0k' }, fetchImpl: fetchImpl as unknown as typeof fetch });
    await tools.get_reviews({});
    const res = await tools.create_issue({ title: 'Crash for @everyone', body: 'Reported by users, closes #3', labels: ['crash'], review_ids: ['syn-003'] });
    expect(res).toMatchObject({ created: true, issue: { url: 'https://github.com/o/r/issues/1' } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/o/r/issues');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer t0k');
    const sent = JSON.parse(init.body as string);
    expect(sent.title).not.toMatch(/@everyone/);
    expect(sent.body).not.toMatch(/closes #3/);
    expect(sent.labels).toContain('from-reviews');
  });

  it('saves reply drafts as pending and validates length', async () => {
    const { tools, ctx } = await setup();
    await tools.get_reviews({});
    await tools.save_reply_draft({ review_id: 'syn-005', language: 'en', text: 'Thanks! An undo button is on our list to look at.' });
    const state = JSON.parse(await readFile(path.join(ctx.dataDir, 'state.json'), 'utf8'));
    expect(state.drafts[0]).toMatchObject({ reviewId: 'syn-005', status: 'pending' });
    await expect(tools.save_reply_draft({ review_id: 'syn-005', language: 'en', text: 'ok' })).rejects.toThrow(/10-600/);
  });

  it('writes the report to a dated file', async () => {
    const { tools } = await setup();
    const out = await tools.write_report({ markdown: '# Weekly report\n\nNo new reviews.' });
    expect(path.basename(out.written)).toMatch(/^report-\d{4}-\d{2}-\d{2}\.md$/);
  });

  it('sanitize breaks mentions and closing keywords', () => {
    expect(sanitize('hi @team, fixes #12')).toBe('hi @​team, fixes #​12');
  });
});

describe('permission policy', () => {
  const live = { dryRun: false, autoApprove: false };
  it('allows reads and local writes, asks before GitHub, denies anything else', () => {
    expect(decide(mcpName('get_reviews'), live).behavior).toBe('allow');
    expect(decide(mcpName('save_reply_draft'), live).behavior).toBe('allow');
    expect(decide(mcpName('create_issue'), live).behavior).toBe('ask');
    expect(decide(mcpName('create_issue'), { dryRun: true, autoApprove: false }).behavior).toBe('allow');
    expect(decide('Bash', live).behavior).toBe('deny');
    expect(decide('mcp__other__create_issue', live).behavior).toBe('deny');
  });
});
