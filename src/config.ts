import path from 'node:path';
import { appStoreSource, fixtureSource, type ReviewSource } from './reviews.js';
import type { ToolContext } from './tools.js';

const env = process.env;
const bool = (v: string | undefined, d: boolean) => (v === undefined ? d : /^(1|true|yes)$/i.test(v));

export type RunConfig = {
  ctx: ToolContext;
  maxTurns: number;
  maxBudgetUsd: number;
  autoApprove: boolean;
  model?: string;
  logFile: string;
};

export function loadConfig(log: ToolContext['log']): RunConfig {
  const appId = env.APP_STORE_ID ?? '6792535365'; // Smart Slide: Block Puzzle
  const sourceSetting = env.REVIEWS_SOURCE ?? 'live';
  const source: ReviewSource = sourceSetting === 'live' ? appStoreSource(appId) : fixtureSource(path.resolve(sourceSetting));
  const github = env.GITHUB_REPO && env.GITHUB_TOKEN ? { repo: env.GITHUB_REPO, token: env.GITHUB_TOKEN } : undefined;

  return {
    ctx: {
      source,
      countries: (env.COUNTRIES ?? 'tr,us,gb,de').split(',').map((s) => s.trim()).filter(Boolean),
      dataDir: path.resolve(env.DATA_DIR ?? 'data'),
      reportsDir: path.resolve(env.REPORTS_DIR ?? 'reports'),
      // Real issues only when explicitly asked for AND GitHub is configured
      dryRun: bool(env.DRY_RUN, true) || !github,
      github,
      maxIssuesPerRun: Number(env.MAX_ISSUES ?? 5),
      log
    },
    maxTurns: Number(env.MAX_TURNS ?? 25),
    maxBudgetUsd: Number(env.MAX_BUDGET_USD ?? 0.5),
    autoApprove: bool(env.AUTO_APPROVE, false),
    model: env.MODEL,
    logFile: path.resolve(env.LOG_DIR ?? 'logs', `run-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`)
  };
}
