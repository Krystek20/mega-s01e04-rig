import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

function isEvent(value: unknown): value is RunEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Record<string, unknown>;
  return typeof event.at === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(event.at)
    && Number.isFinite(Date.parse(event.at))
    && typeof event.job === 'string' && event.job.length > 0
    && (event.status === 'ok' || event.status === 'retry' || event.status === 'fail')
    && (event.owner === null || typeof event.owner === 'string')
    && (event.error === undefined || typeof event.error === 'string');
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;
  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const jobs = new Map<string, { row: DigestRow; errorAt: number }>();
  const eventCounts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event: unknown;
    try { event = JSON.parse(line); } catch { badLines++; continue; }
    if (!isEvent(event)) { badLines++; continue; }
    eventCounts[event.status]++;
    const time = Date.parse(event.at);
    const existing = jobs.get(event.job);
    if (!existing) {
      jobs.set(event.job, {
        row: {
          job: event.job, owner: event.owner, runs: 1,
          retries: event.status === 'retry' ? 1 : 0,
          lastStatus: event.status, lastError: event.error ?? null,
          firstAt: event.at, lastAt: event.at,
        },
        errorAt: event.error === undefined ? -Infinity : time,
      });
      continue;
    }
    const { row } = existing;
    row.runs++;
    if (event.status === 'retry') row.retries++;
    if (time < Date.parse(row.firstAt)) row.firstAt = event.at;
    if (time >= Date.parse(row.lastAt)) {
      row.lastAt = event.at;
      row.lastStatus = event.status;
      row.owner = event.owner;
    }
    if (event.error !== undefined && time >= existing.errorAt) {
      row.lastError = event.error;
      existing.errorAt = time;
    }
  }

  const rows = [...jobs.values()].map(({ row }) => row)
    .sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return { night, rows, badLines, eventCounts };
};
