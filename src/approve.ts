import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { StateStore } from './state.js';

/** Human-in-the-loop step: go through the reply drafts the agent saved and approve or reject each one. */
const store = new StateStore(path.resolve(process.env.DATA_DIR ?? 'data'));
const state = await store.load();
const pending = state.drafts.filter((d) => d.status === 'pending');

if (!pending.length) {
  console.log('No drafts waiting for approval.');
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
for (const d of pending) {
  console.log(`\nReview ${d.reviewId} (${d.language}):\n  ${d.text}`);
  const a = (await rl.question('[a]pprove / [r]eject / [s]kip? ')).trim().toLowerCase();
  if (a === 'a') d.status = 'approved';
  if (a === 'r') d.status = 'rejected';
}
rl.close();
await store.save(state);

const approved = state.drafts.filter((d) => d.status === 'approved');
console.log(`\n${approved.length} approved. Paste them into App Store Connect → Ratings and Reviews.`);
