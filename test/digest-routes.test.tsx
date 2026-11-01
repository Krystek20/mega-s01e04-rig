import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const temporaryDirs: string[] = [];
const originalMarker = process.env.LANE_MARKER;

function fixture(contents: string) {
  const runsDir = mkdtempSync(join(tmpdir(), 'rig-routes-'));
  temporaryDirs.push(runsDir);
  writeFileSync(join(runsDir, '2026-10-28.jsonl'), contents);
  return runsDir;
}

function config(runsDir: string) {
  return { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir };
}

function event(job: string, at: string, status: 'ok' | 'retry' | 'fail', owner: string | null, error?: string) {
  return JSON.stringify({ job, at, status, owner, ...(error === undefined ? {} : { error }) });
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (originalMarker === undefined) delete process.env.LANE_MARKER;
  else process.env.LANE_MARKER = originalMarker;
});

describe('digest routes', () => {
  it('renders the shared sorted aggregates and matches JSON, including warnings and offsets', async () => {
    process.env.LANE_MARKER = 'ROUTE-TEST-MARKER';
    const runsDir = fixture([
      event('zeta/job', '2026-10-28T02:00:00+02:00', 'fail', 'owner-z', 'last failure'),
      event('alpha/job', '2026-10-28T08:30:00-04:00', 'retry', null, 'first retry'),
      event('alpha/job', '2026-10-28T12:45:00Z', 'retry', null, 'second retry'),
      event('alpha/job', '2026-10-28T13:00:00Z', 'retry', null, 'third retry'),
      event('alpha/job', '2026-10-28T15:00:00+01:00', 'ok', null),
      '{invalid json',
      '',
    ].join('\n'));
    const app = createApp(config(runsDir));

    const [htmlResponse, jsonResponse] = await Promise.all([
      app.request('/digest/2026-10-28'),
      app.request('/api/digest/2026-10-28'),
    ]);
    const html = await htmlResponse.text();
    const json = await jsonResponse.json() as {
      night: string;
      badLines: number;
      eventCounts: { ok: number; retry: number; fail: number };
      rows: Array<{ job: string; owner: string | null; runs: number; retries: number; lastStatus: string; lastError: string | null; firstAt: string; lastAt: string }>;
    };

    expect(htmlResponse.status).toBe(200);
    expect(html).toContain('ROUTE-TEST-MARKER');
    expect(html).toContain('bad lines: 1');
    expect(html).toContain('—');
    expect(html).toContain('2026-10-28T08:30:00-04:00');
    expect(html).toContain('2026-10-28T15:00:00+01:00');
    expect(html).toContain('2026-10-28T02:00:00+02:00');
    expect(html).toContain('last failure');
    expect(html).toContain('class="warn"');
    expect(html.indexOf('alpha/job')).toBeLessThan(html.indexOf('zeta/job'));

    expect(jsonResponse.status).toBe(200);
    expect(jsonResponse.headers.get('content-type')).toContain('application/json');
    expect(json).toEqual({
      night: '2026-10-28',
      badLines: 1,
      eventCounts: { ok: 1, retry: 3, fail: 1 },
      rows: [
        { job: 'alpha/job', owner: null, runs: 4, retries: 3, lastStatus: 'ok', lastError: 'third retry', firstAt: '2026-10-28T08:30:00-04:00', lastAt: '2026-10-28T15:00:00+01:00' },
        { job: 'zeta/job', owner: 'owner-z', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'last failure', firstAt: '2026-10-28T02:00:00+02:00', lastAt: '2026-10-28T02:00:00+02:00' },
      ],
    });
    for (const row of json.rows) {
      expect(html).toContain(row.job);
      expect(html).toContain(String(row.runs));
      expect(html).toContain(String(row.retries));
      expect(html).toContain(row.lastStatus);
      if (row.lastError) expect(html).toContain(row.lastError);
    }
  });

  it('returns 404 for a missing night and 200 with nothing ran for an empty night', async () => {
    const runsDir = fixture('');
    const app = createApp(config(runsDir));

    const missingHtml = await app.request('/digest/2026-10-29');
    const missingJson = await app.request('/api/digest/2026-10-29');
    expect(missingHtml.status).toBe(404);
    expect(missingJson.status).toBe(404);

    const [emptyHtml, emptyJson] = await Promise.all([
      app.request('/digest/2026-10-28'),
      app.request('/api/digest/2026-10-28'),
    ]);
    expect(emptyHtml.status).toBe(200);
    expect(await emptyHtml.text()).toContain('nothing ran');
    expect(emptyJson.status).toBe(200);
    expect(await emptyJson.json()).toMatchObject({ rows: [], badLines: 0 });
  });

  it('keeps valid rows when a line is malformed', async () => {
    const runsDir = fixture(['not-json', event('kept/job', '2026-10-28T00:00:00Z', 'ok', 'owner')].join('\n'));
    const app = createApp(config(runsDir));
    const [htmlResponse, jsonResponse] = await Promise.all([
      app.request('/digest/2026-10-28'),
      app.request('/api/digest/2026-10-28'),
    ]);

    expect(htmlResponse.status).toBe(200);
    expect(await htmlResponse.text()).toContain('kept/job');
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toMatchObject({ badLines: 1, rows: [{ job: 'kept/job' }] });
  });

  it('links the digest on the board and reports valid event counts only', async () => {
    const runsDir = fixture([
      event('one', '2026-10-28T00:00:00Z', 'ok', null),
      event('one', '2026-10-28T00:01:00Z', 'retry', null),
      event('two', '2026-10-28T00:02:00Z', 'fail', null),
      'malformed',
    ].join('\n'));
    const htmlResponse = await createApp(config(runsDir)).request('/');
    const html = await htmlResponse.text();

    expect(htmlResponse.status).toBe(200);
    expect(html).toContain('href="/digest/2026-10-28"');
    expect(html).toContain('<td>1</td><td>1</td><td>1</td>');
  });
});
