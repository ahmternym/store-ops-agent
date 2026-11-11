import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type IssueRecord = {
  key: string;
  title: string;
  labels: string[];
  reviewIds: string[];
  url: string | null; // null when created in dry-run mode
  createdAt: string;
};

export type DraftRecord = {
  reviewId: string;
  language: string;
  text: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
};

export type State = {
  seen: string[];
  issues: IssueRecord[];
  drafts: DraftRecord[];
};

const empty = (): State => ({ seen: [], issues: [], drafts: [] });

/** Small JSON file that remembers what the agent already handled, so a weekly run never repeats work. */
export class StateStore {
  private file: string;
  constructor(private dir: string) {
    this.file = path.join(dir, 'state.json');
  }

  async load(): Promise<State> {
    try {
      return { ...empty(), ...JSON.parse(await readFile(this.file, 'utf8')) };
    } catch {
      return empty();
    }
  }

  async save(state: State) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file, JSON.stringify(state, null, 2) + '\n');
  }

  async update<T>(fn: (s: State) => T): Promise<T> {
    const s = await this.load();
    const out = fn(s);
    await this.save(s);
    return out;
  }
}
