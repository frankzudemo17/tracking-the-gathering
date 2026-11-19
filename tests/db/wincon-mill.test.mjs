// P18 Siegbedingung „Mill“ (Migration 20261121000000_wincon_mill.sql): Enum win_condition bekommt 'mill'
// hinter 'gift'; danach entspricht das Enum genau der App-Liste (src/game/engine.js WINCONS, gleiche
// Reihenfolge). Gegenprobe: Stand vor der Migration kennt 'mill' nicht.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './harness.mjs';
import { WINCONS } from '../../src/game/engine.js';

const FILE = '20261121000000_wincon_mill.sql';
const enumOf = async (db) => (await db.query(`select unnest(enum_range(null::public.win_condition))::text as v`)).rows.map((r) => r.v);

test('Mill: Enum nach allen Migrationen = App-Liste, mill hinter gift', async () => {
  const db = await freshDb();
  const vals = await enumOf(db);
  assert.deepEqual(vals, WINCONS);
  assert.equal(vals.indexOf('mill'), vals.indexOf('gift') + 1);
  assert.equal((await db.query(`select 'mill'::public.win_condition::text as v`)).rows[0].v, 'mill');
  await db.close();
});

test('Mill: Gegenprobe vor der Migration ohne mill, übrige Werte unverändert', async () => {
  const db = await freshDb({ until: FILE });
  const vals = await enumOf(db);
  assert.ok(!vals.includes('mill'));
  assert.deepEqual(vals, WINCONS.filter((w) => w !== 'mill'));
  await assert.rejects(db.query(`select 'mill'::public.win_condition`));
  await db.close();
});
