import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const hash = text => createHash('sha256').update(text).digest('hex');

test('Supabase SQL makes each QR one-use and rewards exactly five stamps', async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  // The two Supabase-specific roles do not exist in the in-memory Postgres engine.
  const migration = (await readFile(new URL('../supabase/setup.sql', import.meta.url), 'utf8'))
    .replaceAll(/^revoke all on .*;\r?\n/gm, '');
  await pg.exec(migration);
  const card = (await pg.query('insert into public.cards(secret,name) values ($1,$2) returning id', ['test-secret', 'Mina'])).rows[0];
  const makeTicket = async n => {
    const raw = String(n).padStart(64, 'a');
    const code = String(n).padStart(10, '0');
    await pg.query('select * from private.issue_ticket($1,$2,$3)', ['test-secret', hash(raw), code]);
    return { raw, code };
  };
  const first = await makeTicket(1);
  const superseded = await makeTicket(2);
  await assert.rejects(() => pg.query('select * from private.redeem_ticket($1,$2,$3,$4,$5,$6)', [hash(first.raw), null, 'Che', 'stamp', 'Coffee', 4900]), /expired/i);
  await pg.query('select * from private.redeem_ticket($1,$2,$3,$4,$5,$6)', [null, superseded.code, 'Che', 'stamp', 'Coffee', 4900]);
  await assert.rejects(() => pg.query('select * from private.redeem_ticket($1,$2,$3,$4,$5,$6)', [null, superseded.code, 'Seal', 'stamp', 'Coffee', 4900]), /Already scanned/i);
  for (let n = 3; n <= 6; n++) {
    const ticket = await makeTicket(n);
    await pg.query('select * from private.redeem_ticket($1,$2,$3,$4,$5,$6)', [hash(ticket.raw), null, 'Seal', 'stamp', 'Coffee', null]);
  }
  const events = (await pg.query('select kind,count(*)::integer as total from public.loyalty_events where card_id=$1 group by kind', [card.id])).rows;
  assert.equal(events.find(x => x.kind === 'stamp').total, 5);
  const reward = await makeTicket(7);
  await pg.query('select * from private.redeem_ticket($1,$2,$3,$4,$5,$6)', [hash(reward.raw), null, 'Che', 'reward', 'Coffee', null]);
  const extra = await makeTicket(8);
  await assert.rejects(() => pg.query('select * from private.redeem_ticket($1,$2,$3,$4,$5,$6)', [hash(extra.raw), null, 'Che', 'reward', 'Coffee', null]), /No free coffee/i);
  const result = (await pg.query('select kind,count(*)::integer as total from public.loyalty_events where card_id=$1 group by kind', [card.id])).rows;
  assert.equal(result.find(x => x.kind === 'reward').total, 1);
});
