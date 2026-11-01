import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';

const temporaryDirs: string[] = [];
function fixture(contents: string) {
  const dir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  temporaryDirs.push(dir);
  writeFileSync(join(dir, '2026-10-28.jsonl'), contents);
  return dir;
}
afterEach(() => { for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true }); });

describe('night reader', () => {
  it('aggregates the real sample without changing it', () => {
    const result = readNight('runs', '2026-10-28');
    expect(result?.badLines).toBe(1);
    expect(result?.eventCounts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(result?.rows.map(row => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(result?.rows[0]).toEqual({ job: 'digest/render', owner: null, runs: 1, retries: 0,
      lastStatus: 'ok', lastError: null, firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00' });
    expect(result?.rows[1]).toMatchObject({ runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503' });
    expect(result?.rows[2]).toMatchObject({ runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held' });
    expect(result?.rows[3]).toMatchObject({ runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('distinguishes empty, missing and invalid night names', () => {
    const dir = fixture('');
    expect(readNight(dir, '2026-10-28')).toEqual({ night: '2026-10-28', rows: [], badLines: 0, eventCounts: { ok: 0, retry: 0, fail: 0 } });
    expect(readNight(dir, '2026-10-29')).toBeNull();
    expect(readNight(dir, '../2026-10-28')).toBeNull();
  });

  it('counts malformed event shapes and ignores blank lines', () => {
    const dir = fixture(['{', 'null', '{}', JSON.stringify({ at: 'tomorrow', job: 'a', status: 'ok', owner: null }),
      JSON.stringify({ at: '2026-10-28T00:00:00Z', job: 'a', status: 'unknown', owner: null }), '',
      JSON.stringify({ at: '2026-10-28T00:00:00Z', job: 'a', status: 'ok', owner: null })].join('\n'));
    expect(readNight(dir, '2026-10-28')).toMatchObject({ badLines: 5, eventCounts: { ok: 1, retry: 0, fail: 0 }, rows: [{ owner: null, runs: 1 }] });
  });

  it('uses chronological instants across offsets and file order for ties', () => {
    const dir = fixture([
      { at: '2026-10-28T02:00:00+01:00', status: 'fail', owner: 'old', error: 'latest error' },
      { at: '2026-10-28T00:00:00Z', status: 'retry', owner: null, error: 'earlier error' },
      { at: '2026-10-28T01:00:00Z', status: 'ok', owner: 'new' },
    ].map(event => JSON.stringify({ ...event, job: 'a' })).join('\n'));
    expect(readNight(dir, '2026-10-28')?.rows).toEqual([{ job: 'a', owner: 'new', runs: 3, retries: 1,
      lastStatus: 'ok', lastError: 'latest error', firstAt: '2026-10-28T00:00:00Z', lastAt: '2026-10-28T01:00:00Z' }]);
  });
});
