/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { currentDevelopFixture, currentRecipe } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { applyPhotoDevelopPresetV2, readPhotoDevelopPresetsV2, readPhotoDevelopPresetV2 } from '../src/lightscaper/storage/photo-develop-presets-v2.ts';
import { readPhotoDevelopPresetsV1, photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { copyImageDevelopSettingsV1 } from '../src/common/editor/imaging/image-develop-settings-v1.ts';
import { createImageDevelopPresetV1, serializeImageDevelopPresetV1 } from '../src/common/editor/imaging/image-develop-preset-v1.ts';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { deferred } from './helpers/async-test-control.ts';

test('current preset storage retains row2 across delete/empty reopen and fences full/partial body selection by revision', async () => {
	const f = await currentDevelopFixture(), presets = f.develop.presets; assert.ok(presets);
	try {
		const packet = f.develop.settings!.copy({ schemaVersion: 2, develop: currentRecipe(), selection: { effectTypes: ['cube-lut-profile-v1'], geometry: false, localAdjustments: false } });
		const preset = presets.create({ schemaVersion: 2, id: 'lut', name: 'LUT', settings: packet });
		const root = await f.repository.loadCatalog('catalog-1');
		await assert.rejects(applyPhotoDevelopPresetV2(f.settings, root, { type: 'save', expectedRevision: 0, preset }), /resource/iu);
		const saved = await applyPhotoDevelopPresetV2(f.settings, root, { type: 'save', expectedRevision: 0, preset }, { verifyResources: async () => undefined });
		assert.equal(saved.schemaVersion, 2); assert.equal(saved.presets[0]?.scope, 'partial');
		const body = await readPhotoDevelopPresetV2(f.settings, 'catalog-1', 'lut', 1); assert.deepEqual(body.preset, preset);
		await assert.rejects(readPhotoDevelopPresetV2(f.settings, 'catalog-1', 'lut', 0), { code: 'DEVELOP_PRESET_REVISION_CONFLICT' });
		await applyPhotoDevelopPresetV2(f.settings, root, { type: 'delete', expectedRevision: 1, presetId: 'lut' });
		const empty = await readPhotoDevelopPresetsV2(f.settings, 'catalog-1'); assert.equal(empty.revision, 2); assert.deepEqual(empty.presets, []);
		assert.equal((await f.settings.get('photo-library:develop-presets:v1:catalog-1') as { schemaVersion: number }).schemaVersion, 2);
	} finally { await f.close(); }
});

test('mixed preset reads preserve old row/body bytes; every retained disabled LUT requires verification even on a no-op or unrelated delete', async () => {
	const f = await currentDevelopFixture(), root = await f.repository.loadCatalog('catalog-1'), key = photoDevelopPresetsKeyV1('catalog-1');
	const legacy = createImageDevelopPresetV1({ schemaVersion: 1, id: 'old', name: 'Old', settings: copyImageDevelopSettingsV1({ schemaVersion: 1,
		develop: defaultImageDevelopStateV1(), selection: { effectTypes: 'all', geometry: true, localAdjustments: true } }) });
	try {
		await applyPhotoDevelopPresetV2(f.settings, root, { type: 'save', expectedRevision: 0, preset: legacy });
		const oldRow: unknown = await f.settings.get(key);
		assert.equal((oldRow as { schemaVersion: number }).schemaVersion, 1);
		assert.equal(serializeImageDevelopPresetV1((await readPhotoDevelopPresetV2(f.settings, 'catalog-1', 'old', 1)).preset), serializeImageDevelopPresetV1(legacy));
		await readPhotoDevelopPresetsV2(f.settings, 'catalog-1'); assert.deepEqual(await f.settings.get(key), oldRow);
		const settings = f.develop.settings!.copy({ schemaVersion: 2, develop: currentRecipe(), selection: { effectTypes: 'all', geometry: true, localAdjustments: true } });
		const preset = f.develop.presets!.create({ schemaVersion: 2, id: 'lut', name: 'LUT', settings });
		await applyPhotoDevelopPresetV2(f.settings, root, { type: 'save', expectedRevision: 1, preset }, { verifyResources: async () => undefined });
		await assert.rejects(readPhotoDevelopPresetsV1(f.settings, 'catalog-1'));
		await assert.rejects(applyPhotoDevelopPresetV2(f.settings, root, { type: 'delete', expectedRevision: 2, presetId: 'old' }), /resource/iu);
		await assert.rejects(applyPhotoDevelopPresetV2(f.settings, root, { type: 'save', expectedRevision: 2, preset }), /resource/iu);
		assert.equal((await readPhotoDevelopPresetsV2(f.settings, 'catalog-1')).revision, 2);
		let calls = 0;
		await applyPhotoDevelopPresetV2(f.settings, root, { type: 'delete', expectedRevision: 2, presetId: 'old' }, { verifyResources: async body => { calls++; assert.deepEqual(body, preset); } });
		assert.equal(calls, 1);
		await applyPhotoDevelopPresetV2(f.settings, root, { type: 'delete', expectedRevision: 3, presetId: 'lut' });
		await applyPhotoDevelopPresetV2(f.settings, root, { type: 'save', expectedRevision: 4, preset: legacy });
		assert.equal((await f.settings.get(key) as { schemaVersion: number }).schemaVersion, 2);
	} finally { await f.close(); }
});

test('next-row shared reference ledger refuses same-digest geometry conflicts before any body verifier or native publication', async () => {
	const f = await currentDevelopFixture(), root = await f.repository.loadCatalog('catalog-1'); let calls = 0;
	const make = (id: string, size: number) => f.develop.presets!.create({ schemaVersion: 2, id, name: id, settings: f.develop.settings!.copy({
		schemaVersion: 2, develop: currentRecipe({ storageKey: `lut-sha256:${'4'.repeat(64)}`, sha256: '4'.repeat(64), byteLength: 88, size,
			domainMin: [0, 0, 0], domainMax: [1, 1, 1] }), selection: { effectTypes: 'all', geometry: true, localAdjustments: true } }) });
	try {
		await applyPhotoDevelopPresetV2(f.settings, root, { type: 'save', expectedRevision: 0, preset: make('first', 2) }, { verifyResources: async () => undefined });
		await assert.rejects(applyPhotoDevelopPresetV2(f.settings, root, { type: 'save', expectedRevision: 1, preset: make('conflict', 3) }, { verifyResources: async () => { calls++; } }), /conflict/iu);
		assert.equal(calls, 0); assert.equal((await readPhotoDevelopPresetsV2(f.settings, 'catalog-1')).revision, 1);
	} finally { await f.close(); }
});

test('actual memory/native point presence rejects malformed retained rows and preserves conditional write aborts and late native ACK', async () => {
	for (const native of [false, true]) {
		const f = await currentDevelopFixture(), raw = createInstrumentedIndexedDB(), name = `current-preset-native-${native}`;
		const db = native ? await openDatabase(raw as unknown as IDBFactory, name) : null, memory = getMemoryDatabase(name);
		const repository = new KeyValueRepository({ memory, database: async () => db }, 'settings'), key = photoDevelopPresetsKeyV1('catalog-1');
		const root = await f.repository.loadCatalog('catalog-1'), preset = createImageDevelopPresetV1({ schemaVersion: 1, id: 'old', name: 'Old', settings: copyImageDevelopSettingsV1({
			schemaVersion: 1, develop: defaultImageDevelopStateV1(), selection: { effectTypes: 'all', geometry: true, localAdjustments: true } }) });
		try {
			for (const wrapper of [{ key, value: undefined }, { key }]) {
				if (native) raw.seedRecord(name, 'settings', wrapper); else memory.settings.set(key, wrapper);
				await assert.rejects(readPhotoDevelopPresetsV2(repository, 'catalog-1'), /value/iu);
				await assert.rejects(applyPhotoDevelopPresetV2(repository, root, { type: 'save', expectedRevision: 0, preset }), /value/iu);
			}
			await repository.delete(key);
			if (native) {
				raw.failNextPutForStore('settings', new DOMException('Quota', 'QuotaExceededError'));
				await assert.rejects(applyPhotoDevelopPresetV2(repository, root, { type: 'save', expectedRevision: 0, preset }));
				assert.equal((await readPhotoDevelopPresetsV2(repository, 'catalog-1')).revision, 0);
			}
			const put = repository.putIfAbsent, entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
			repository.putIfAbsent = async function (...args) { const ack = await Reflect.apply(put, repository, args); entered.resolve(); await release.promise; return ack; };
			const work = applyPhotoDevelopPresetV2(repository, root, { type: 'save', expectedRevision: 0, preset }, { signal: stop.signal });
			await entered.promise; stop.abort(Object.freeze({ after: 'native ACK' })); release.resolve();
			assert.equal((await work).revision, 1); assert.equal((await readPhotoDevelopPresetsV2(repository, 'catalog-1')).revision, 1);
		} finally { db?.close(); await f.close(); }
	}
});

test('preset conditional write reconciles an exact lost ACK without cancellation downgrading durable row2', async () => {
	const f = await currentDevelopFixture(), root = await f.repository.loadCatalog('catalog-1'), stop = new AbortController();
	let traps = 0; const failure = new Proxy({}, { get() { traps++; throw Error('Opaque get'); }, getPrototypeOf() { traps++; throw Error('Opaque prototype'); } });
	const preset = f.develop.presets!.create({ schemaVersion: 2, id: 'neutral', name: 'Neutral', settings: f.develop.settings!.copy({
		schemaVersion: 2, develop: currentRecipe(null), selection: { effectTypes: 'all', geometry: true, localAdjustments: true } }) });
	const put = f.settings.putIfAbsent;
	f.settings.putIfAbsent = async function (...args) { await Reflect.apply(put, f.settings, args); stop.abort(failure); throw failure; };
	try {
		const ack = await applyPhotoDevelopPresetV2(f.settings, root, { type: 'save', expectedRevision: 0, preset }, { signal: stop.signal });
		assert.equal(ack.revision, 1); assert.equal(ack.presets[0]?.id, 'neutral'); assert.equal(traps, 0);
		assert.equal((await f.settings.get(photoDevelopPresetsKeyV1('catalog-1')) as { schemaVersion: number }).schemaVersion, 2);
	} finally { await f.close(); }
});
