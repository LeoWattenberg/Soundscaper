/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { capturePhotoDevelopPresetsArchiveV1 } from '../src/lightscaper/storage/photo-develop-presets-archive-v1.ts';
import { readPhotoDevelopPresetsV1, readPhotoDevelopPresetV1, applyPhotoDevelopPresetV1, photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { queryCatalogRootV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { createImageDevelopPresetV1 } from '../src/common/editor/imaging/image-develop-preset-v1.ts';
import { copyImageDevelopSettingsV1 } from '../src/common/editor/imaging/image-develop-settings-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import type { PhotoDevelopPresetArchiveSettingsPortV1 } from '../src/lightscaper/storage/photo-develop-presets-archive-v1.ts';

const key = photoDevelopPresetsKeyV1('catalog');
const empty = { schemaVersion: 1, kind: 'photo-develop-presets', catalogId: 'catalog', revision: 91, presets: [] };
const preset = createImageDevelopPresetV1({ schemaVersion: 1, id: 'preset', name: 'Evening', settings: copyImageDevelopSettingsV1({
	schemaVersion: 1, develop: defaultImageDevelopStateV1(), selection: { effectTypes: 'all', geometry: true, localAdjustments: true } }) });

for (const native of [false, true]) {
	async function fixture() {
		const name = `preset-presence-${crypto.randomUUID()}`, raw = createInstrumentedIndexedDB(), memory = getMemoryDatabase(name);
		const database = native ? await openDatabase(raw as unknown as IDBFactory, name) : null;
		return { raw, database, memory, repository: new KeyValueRepository({ memory, database: async () => database }, 'settings'),
			seed(wrapper: unknown) { if (native) raw.seedRecord(name, 'settings', wrapper); else memory.settings.set(key, wrapper); },
			rows: () => native ? raw.records(name, 'settings') : [...memory.settings.values()] };
	}
	for (const operation of ['capture', 'list', 'read', 'write'] as const) test(`${native ? 'native' : 'memory'} malformed physical preset rows refuse ${operation}`, async () => {
		const f = await fixture();
		try {
			for (const wrapper of [{ key, value: undefined }, { key }]) {
				f.seed(wrapper); const before = structuredClone(f.rows());
				const pending = operation === 'capture' ? capturePhotoDevelopPresetsArchiveV1(f.repository, 'catalog')
					: operation === 'list' ? readPhotoDevelopPresetsV1(f.repository, 'catalog')
						: operation === 'read' ? readPhotoDevelopPresetV1(f.repository, 'catalog', 'preset', 0)
							: applyPhotoDevelopPresetV1(f.repository, queryCatalogRootV1(), { type: 'save', expectedRevision: 0, preset });
				await assert.rejects(pending, TypeError);
				assert.deepEqual(f.rows(), before);
			}
		} finally { f.database?.close(); }
	});
	test(`${native ? 'native' : 'memory'} absent capture cannot authenticate a later malformed physical row`, async () => {
		const f = await fixture();
		try {
			const capture = await capturePhotoDevelopPresetsArchiveV1(f.repository, 'catalog'); assert.equal(capture.row, null);
			f.seed({ key }); await assert.rejects(capture.verify(), TypeError);
		} finally { f.database?.close(); }
	});
	test(`${native ? 'native' : 'memory'} legal absence and retained empty revisions remain distinct`, async () => {
		const f = await fixture();
		try {
			assert.equal((await readPhotoDevelopPresetsV1(f.repository, 'catalog')).revision, 0);
			await f.repository.put(key, empty);
			const capture = await capturePhotoDevelopPresetsArchiveV1(f.repository, 'catalog'); await capture.verify();
			assert.deepEqual(capture.row, empty); assert.equal((await readPhotoDevelopPresetsV1(f.repository, 'catalog')).revision, 91);
		} finally { f.database?.close(); }
	});
}

for (const phase of ['capture', 'verify'] as const) test(`actual native ${phase} settlement preserves opaque cancellation before malformed entry admission`, async () => {
	const raw = createInstrumentedIndexedDB(), name = `preset-native-abort-${crypto.randomUUID()}`;
	const database = await openDatabase(raw as unknown as IDBFactory, name), stop = new AbortController(); let inspections = 0;
	const reason = new Proxy({}, { get() { inspections++; throw new Error('Opaque read'); }, getPrototypeOf() { inspections++; throw new Error('Opaque prototype'); } });
	const repository = new KeyValueRepository({ memory: getMemoryDatabase(name), database: async () => database }, 'settings');
	try {
		const captured = phase === 'verify' ? await capturePhotoDevelopPresetsArchiveV1(repository, 'catalog', { signal: stop.signal }) : null;
		raw.seedRecord(name, 'settings', { key }); raw.onNextGetForStore('settings', () => { stop.abort(reason); });
		let failure: unknown;
		await (captured ? captured.verify() : capturePhotoDevelopPresetsArchiveV1(repository, 'catalog', { signal: stop.signal })).catch((error: unknown) => { failure = error; });
		assert.equal(failure, reason); assert.equal(inspections, 0); assert.equal(raw.stats.activeTransactions, 0);
	} finally { database.close(); }
});

test('archive point-entry capability is mandatory and its presence union is closed without running accessors', async () => {
	let legacyReads = 0, accessors = 0;
	await assert.rejects(capturePhotoDevelopPresetsArchiveV1({ async get() { legacyReads++; } } as unknown as PhotoDevelopPresetArchiveSettingsPortV1, 'catalog'), TypeError);
	assert.equal(legacyReads, 0);
	for (const entry of [{ present: false, value: empty }, { present: true }, { present: 'false' },
		{ present: true, value: empty, extra: 1 }, Object.defineProperty({}, 'present', { get() { accessors++; return false; } })]) {
		await assert.rejects(capturePhotoDevelopPresetsArchiveV1({ readEntry: async () => entry } as unknown as PhotoDevelopPresetArchiveSettingsPortV1, 'catalog'));
	}
	assert.equal(accessors, 0);
});
