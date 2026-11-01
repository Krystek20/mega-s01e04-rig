import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { readNight } from './read-night.js';

export function registerDigestJson(app: Hono, config: RigConfig): void {
  app.get('/api/digest/:night', (c) => {
    const digest = readNight(config.runsDir, c.req.param('night'));
    return digest === null
      ? c.json({ error: 'night not found' }, 404)
      : c.json(digest);
  });
}
