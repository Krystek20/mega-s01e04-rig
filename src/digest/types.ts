export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  night: string;
  /** Job rows sorted by code-point job name, shared unchanged by HTML and JSON. */
  rows: DigestRow[];
  badLines: number;
  /** Counts of valid log events, not final job states. */
  eventCounts: Record<RunStatus, number>;
};

/**
 * Read runsDir/<night>.jsonl; null means missing file or invalid YYYY-MM-DD night.
 * Empty files yield an empty digest. Blank lines are ignored; invalid JSON or
 * invalid event fields count as bad lines. Other filesystem errors propagate.
 * Runs counts all valid events; retries counts retry events. First/last use
 * chronological instants, keeping original timestamp strings and offsets.
 * Equal timestamps use file order (later line wins for last state/owner).
 * Owner and lastStatus come from the latest event. lastError is the latest
 * supplied error across the job's events, retained after a later successful run.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
