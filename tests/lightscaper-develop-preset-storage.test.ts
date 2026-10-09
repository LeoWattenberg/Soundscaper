/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { createImageDevelopPresetV1 } from '../src/common/editor/imaging/image-develop-preset-v1.ts';
import { copyImageDevelopSettingsV1 } from '../src/common/editor/imaging/image-develop-settings-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { readPhotoDevelopPresetsV1, readPhotoDevelopPresetV1, applyPhotoDevelopPresetV1,
	normalizePhotoDevelopPresetCommandV1, normalizePhotoDevelopPresetRowV1, photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { queryCatalogRootV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';

const make = (id = 'preset', name = 'Evening') => createImageDevelopPresetV1({ schemaVersion: 1, id, name,
	settings: copyImageDevelopSettingsV1({ schemaVersion: 1, develop: defaultImageDevelopStateV1(),
		selection: { effectTypes: 'all', geometry: true, localAdjustments: true } }) });
const save = (expectedRevision = 0, id = 'preset', name = 'Evening') => ({ type: 'save', expectedRevision, preset: make(id, name) });
function fixture() {
	const repository = new KeyValueRepository({ memory: getMemoryDatabase(`develop-presets-${crypto.randomUUID()}`), database: async () => null }, 'settings');
	const calls: string[] = [];
	const port = {
		get: async (key: string) => { calls.push('get'); return repository.get(key); },
		putIfAbsent: async (key: string, value: unknown) => { calls.push('create'); return repository.putIfAbsent(key, value); },
		replaceIfCurrent: async (key: string, expected: unknown, value: unknown) => { calls.push('replace'); return repository.replaceIfCurrent(key, expected, value); },
	};
	return { repository, port, calls, root: queryCatalogRootV1(), key: photoDevelopPresetsKeyV1('catalog') };
}

test('Develop presets use one revision-fenced catalog row and return scalar menus without recipe bodies', async () => {
	const f = fixture(); await f.repository.put('unrelated', { keep: true });
	assert.deepEqual(await readPhotoDevelopPresetsV1(f.port, 'catalog'), { schemaVersion: 1, catalogId: 'catalog', revision: 0, presets: [] });
	const created = await applyPhotoDevelopPresetV1(f.port, f.root, save());
	assert.equal(created.revision, 1); assert.deepEqual(Object.keys(created.presets[0]!).sort(), ['authoredStateSha256', 'id', 'name', 'scope']);
	assert.equal(created.presets[0]?.scope, 'full');
	assert.deepEqual((await readPhotoDevelopPresetV1(f.port, 'catalog', 'preset', 1)).preset, make());
	assert.equal((await applyPhotoDevelopPresetV1(f.port, f.root, save(1))).revision, 1);
	assert.equal(f.calls.filter(call => call === 'replace').length, 0);
	const renamed = await applyPhotoDevelopPresetV1(f.port, f.root, save(1, 'preset', 'Warm'));
	assert.equal(renamed.revision, 2); assert.equal(renamed.presets[0]?.name, 'Warm');
	const cleared = await applyPhotoDevelopPresetV1(f.port, f.root, { type: 'delete', expectedRevision: 2, presetId: 'preset' });
	assert.deepEqual(cleared, { schemaVersion: 1, catalogId: 'catalog', revision: 3, presets: [] });
	assert.equal((await applyPhotoDevelopPresetV1(f.port, f.root, save(3))).revision, 4);
	assert.deepEqual(await f.repository.get('unrelated'), { keep: true });
});

test('Two independent first writers have one CAS winner and stale menu/body reads cannot borrow a newer preset', async () => {
	const f = fixture();
	const results = await Promise.allSettled([applyPhotoDevelopPresetV1(f.port, f.root, save(0, 'a')), applyPhotoDevelopPresetV1(f.port, f.root, save(0, 'b'))]);
	assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
	assert.equal((await readPhotoDevelopPresetsV1(f.port, 'catalog')).presets.length, 1);
	await assert.rejects(applyPhotoDevelopPresetV1(f.port, f.root, save()), { code: 'DEVELOP_PRESET_REVISION_CONFLICT' });
	await assert.rejects(readPhotoDevelopPresetV1(f.port, 'catalog', 'a', 0), { code: 'DEVELOP_PRESET_REVISION_CONFLICT' });
	await assert.rejects(readPhotoDevelopPresetV1(f.port, 'catalog', 'missing', 1), ReferenceError);
	await assert.rejects(applyPhotoDevelopPresetV1(f.port, f.root, { type: 'delete', expectedRevision: 1, presetId: 'missing' }), ReferenceError);
});

test('Publication reconciliation retains a durable preset ACK and preserves the exact pre-ACK failure', async () => {
	const durable = fixture(), failure = Object.freeze({ opaque: 'publication failed' });
	durable.port.putIfAbsent = async (key, value) => { await durable.repository.putIfAbsent(key, value); throw failure; };
	assert.equal((await applyPhotoDevelopPresetV1(durable.port, durable.root, save())).revision, 1);
	const failed = fixture(); failed.port.putIfAbsent = async () => { throw failure; };
	await assert.rejects(applyPhotoDevelopPresetV1(failed.port, failed.root, save()), error => error === failure);
	assert.equal(await failed.repository.get(failed.key), undefined);
});

test('A later row with the same recipe digest cannot substitute for the exact failed publication', async () => {
	const f = fixture(), failure = Object.freeze({ publication: 'uncertain' });
	f.port.putIfAbsent = async (key, value) => {
		await f.repository.putIfAbsent(key, value);
		await f.repository.put(key, { schemaVersion: 1, kind: 'photo-develop-presets', catalogId: 'catalog', revision: 2, presets: [make('preset', 'Later winner')] });
		throw failure;
	};
	await assert.rejects(applyPhotoDevelopPresetV1(f.port, f.root, save()), error => error === failure);
	assert.equal((await readPhotoDevelopPresetsV1(f.port, 'catalog')).presets[0]?.name, 'Later winner');
});

test('A failed reconciliation preserves both opaque failures and the immediate cause without claiming publication', async () => {
	const f = fixture(), failure = Object.freeze({ write: true }), reconciliation = Object.freeze({ read: true });
	let reads = 0;
	f.port.get = async key => { if (++reads > 1) throw reconciliation; return f.repository.get(key); };
	f.port.putIfAbsent = async () => { throw failure; };
	await assert.rejects(applyPhotoDevelopPresetV1(f.port, f.root, save()), (error: unknown) => {
		assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [failure, reconciliation]); assert.equal(error.cause, reconciliation); return true;
	});
	assert.equal(await f.repository.get(f.key), undefined);
});

test('Sixteen maximal escaped names fit the scalar menu bound; large valid bodies obey the separate aggregate row bound', async () => {
	const f = fixture();
	const presets = Array.from({ length: 16 }, (_, index) => make(`preset-${String(index)}`, '\ud800'.repeat(512)));
	const row = normalizePhotoDevelopPresetRowV1({ schemaVersion: 1, kind: 'photo-develop-presets', catalogId: 'catalog', revision: 1, presets }, 'catalog');
	await f.repository.put(f.key, row);
	assert.ok(new TextEncoder().encode(JSON.stringify(await readPhotoDevelopPresetsV1(f.port, 'catalog'))).byteLength < 65_536);
	const point = { position: { x: 0.1234567890123456, y: 0.1234567890123456 }, inHandle: null, outHandle: null };
	const settings = copyImageDevelopSettingsV1({ schemaVersion: 1, selection: { effectTypes: 'all', geometry: true, localAdjustments: true },
		develop: { ...defaultImageDevelopStateV1(), masks: [{ schemaVersion: 1, id: 'path', kind: 'mask', inputs: [], outputNodeId: 'node',
			nodes: [{ id: 'node', kind: 'vector-path', fillRule: 'nonzero', paths: [{ id: 'outline', closed: true, points: Array.from({ length: 16_384 }, () => point) }] }] }] } });
	const large = Array.from({ length: 8 }, (_, index) => createImageDevelopPresetV1({ schemaVersion: 1, id: `large-${String(index)}`, name: 'Large', settings }));
	assert.ok(new TextEncoder().encode(JSON.stringify(large[0])).byteLength < 2_097_152);
	assert.throws(() => normalizePhotoDevelopPresetRowV1({ schemaVersion: 1, kind: 'photo-develop-presets', catalogId: 'catalog', revision: 1, presets: large }, 'catalog'), /byte bound/iu);
});

test('Cancellation before admission/read refuses unchanged; cancellation during held durable completion retains the ACK', async () => {
	const f = fixture(), controller = new AbortController(), reason = Object.freeze({ opaque: 'cancel' });
	controller.abort(reason);
	await assert.rejects(applyPhotoDevelopPresetV1(f.port, f.root, save(), { signal: controller.signal }), error => error === reason);
	assert.deepEqual(f.calls, []);
	const during = fixture(), held = deferred<void>(), entered = deferred<void>(), active = new AbortController();
	during.port.putIfAbsent = async (key, value) => { const published = await during.repository.putIfAbsent(key, value); entered.resolve(); await held.promise; return published; };
	const saving = applyPhotoDevelopPresetV1(during.port, during.root, save(), { signal: active.signal });
	await entered.promise; active.abort(reason); held.resolve();
	assert.equal((await saving).revision, 1);
	const reading = fixture(), readGate = deferred<void>(), readEntered = deferred<void>(), readSignal = new AbortController();
	reading.port.get = async key => { readEntered.resolve(); await readGate.promise; return reading.repository.get(key); };
	const pending = readPhotoDevelopPresetsV1(reading.port, 'catalog', { signal: readSignal.signal });
	await readEntered.promise; readSignal.abort(reason); readGate.resolve();
	await assert.rejects(pending, error => error === reason);
});

test('Row admission is closed, catalog-bound, sorted, unique and refuses unsupported identities without coercion', () => {
	const row = { schemaVersion: 1, kind: 'photo-develop-presets', catalogId: 'catalog', revision: 1, presets: [make('z'), make('a')] };
	assert.deepEqual(normalizePhotoDevelopPresetRowV1(row, 'catalog').presets.map(preset => preset.identity.id), ['a', 'z']);
	for (const value of [{ ...row, catalogId: 'foreign' }, { ...row, schemaVersion: 2 }, { ...row, revision: 0 },
		{ ...row, presets: [make(), make()] }, { ...row, presets: Array.from({ length: 17 }, (_, index) => make(`p-${String(index)}`)) }, { ...row, original: 'donor' }]) {
		assert.throws(() => normalizePhotoDevelopPresetRowV1(value, 'catalog'));
	}
	let invoked = 0;
	const hostile = Object.defineProperty(save(), 'preset', { enumerable: true, get() { invoked++; return make(); } });
	assert.throws(() => normalizePhotoDevelopPresetCommandV1(hostile));
	assert.throws(() => photoDevelopPresetsKeyV1({ toString() { invoked++; return 'catalog'; } } as unknown as string));
	assert.equal(invoked, 0);
});

test('A noncanonical stored field order remains its exact CAS witness while the next row is canonical', async () => {
	const f = fixture(), preset = make();
	const raw = { presets: [preset], revision: 1, catalogId: 'catalog', kind: 'photo-develop-presets', schemaVersion: 1 };
	await f.repository.put(f.key, raw);
	const next = await applyPhotoDevelopPresetV1(f.port, f.root, save(1, 'a'));
	assert.equal(next.revision, 2); assert.deepEqual(next.presets.map(item => item.id), ['a', 'preset']);
});
