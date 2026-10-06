import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../api/index.js';

test('Vercel API config identifies the hosted app', async () => {
  const response = await handle(new Request('https://example.vercel.app/api/index?path=config'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).cloud, true);
});

test('staff API rejects a request without an email-code session', async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:6543/postgres';
  try {
    const response = await handle(new Request('https://example.vercel.app/api/index?staff=1&path=config'));
    assert.equal(response.status, 401);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});
