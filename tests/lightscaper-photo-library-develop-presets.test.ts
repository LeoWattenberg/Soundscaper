/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';
import type { PhotoLibraryDevelopPresetWriteV1 } from '../src/common/editor/photo-library-develop-presets-port-v1.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import type { VideoEffectLeaf } from '../src/common/editor/project-media-types.ts';
import { developBatchFixture, developBatchTime } from './helpers/lightscaper-develop-batch-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';

async function fixture() {
	const base = await developBatchFixture();
	const repository = new KeyValueRepository({ memory: getMemoryDatabase(`session-develop-presets-${crypto.randomUUID()}`), database: async () => null }, 'settings');
	base.ports.settings = repository;
	const owner = new PhotoLibrarySessionV1(base.ports), presets = owner.develop.presets;
	assert.ok(presets, 'Develop preset capability is available when the Session owns a settings repository');
	const packet = base.settings.copy({ schemaVersion: 1, develop: defaultPhotoDevelopV1(), selection: { effectTypes: 'all', geometry: true, localAdjustments: true } });
	const preset = presets.create({ schemaVersion: 1, id: 'preset', name: 'Evening', settings: packet });
	const save = (expectedRevision = 0): PhotoLibraryDevelopPresetWriteV1 => ({ schemaVersion: 1, catalogId: 'catalog', command: { type: 'save', expectedRevision, preset } });
	return { base, repository, owner, presets, preset, save, close: async () => { await owner.close(); await base.close(); } };
}

test('Preset menus use scalar revisions and selected bodies survive Session reopening without editing photo facts', async () => {
	const f = await fixture();
	try {
		assert.equal((await f.presets.list({ schemaVersion: 1, catalogId: 'catalog' })).revision, 0);
		const saved = await f.presets.write(f.save()); assert.equal(saved.snapshot.revision, 1); assert.deepEqual(saved.notices, []);
		const read = await f.presets.read({ schemaVersion: 1, catalogId: 'catalog', presetId: 'preset', expectedRevision: 1 });
		assert.deepEqual(read.preset, f.preset); assert.equal(read.revision, 1);
		assert.deepEqual(f.presets.parse(f.presets.serialize(read.preset)), read.preset);
		const photo = await f.base.repository.loadPhoto('catalog', f.base.photos[0]!.id);
		assert.deepEqual(photo, f.base.photos[0]); assert.equal((await f.base.repository.loadCatalog('catalog'))?.revision, 1);
		await f.owner.close();
		const reopened = new PhotoLibrarySessionV1(f.base.ports);
		try { assert.equal((await reopened.develop.presets!.list({ schemaVersion: 1, catalogId: 'catalog' })).presets[0]?.name, 'Evening'); }
		finally { await reopened.close(); }
	} finally { await f.close(); }
});

test('Preset capability remains absent when no settings repository exists', async () => {
	const f = await developBatchFixture();
	try { assert.equal(f.owner.develop.presets, undefined); }
	finally { await f.close(); }
});

test('An explicitly owned Develop preset repository enables presets without an import-settings port', async () => {
	const f = await developBatchFixture();
	const repository = new KeyValueRepository({ memory: getMemoryDatabase(`explicit-develop-presets-${crypto.randomUUID()}`), database: async () => null }, 'settings');
	f.ports.developPresetSettings = repository;
	const owner = new PhotoLibrarySessionV1(f.ports);
	try {
		assert.equal(f.ports.settings, undefined); assert.ok(owner.develop.presets);
		const packet = f.settings.copy({ schemaVersion: 1, develop: defaultPhotoDevelopV1(),
			selection: { effectTypes: 'all', geometry: true, localAdjustments: true } });
		const preset = owner.develop.presets.create({ schemaVersion: 1, id: 'explicit', name: 'Explicit', settings: packet });
		const saved = await owner.develop.presets.write({ schemaVersion: 1, catalogId: 'catalog',
			command: { type: 'save', expectedRevision: 0, preset } });
		assert.equal(saved.snapshot.revision, 1);
		assert.equal((await owner.develop.presets.list({ schemaVersion: 1, catalogId: 'catalog' })).presets[0]?.name, 'Explicit');
	} finally { await owner.close(); await f.close(); }
});

test('Closed preset requests refuse accessors before lazy initialization and fence catalog/revision explicitly', async () => {
	const f = await fixture();
	try {
		let invoked = 0;
		const hostile = Object.defineProperty(f.save(), 'command', { enumerable: true, get() { invoked++; return f.save().command; } });
		await assert.rejects(f.presets.write(hostile), /own data/iu);
		assert.equal(invoked, 0); assert.equal(f.base.calls.initialize, 0); assert.equal(f.base.calls.locks, 0);
		await assert.rejects(f.presets.list({ schemaVersion: 1, catalogId: 'foreign' }), /another catalog/iu);
		await f.presets.write(f.save());
		await assert.rejects(f.presets.read({ schemaVersion: 1, catalogId: 'catalog', presetId: 'preset', expectedRevision: 0 }), { code: 'DEVELOP_PRESET_REVISION_CONFLICT' });
		await assert.rejects(f.presets.write(f.save()), { code: 'DEVELOP_PRESET_REVISION_CONFLICT' });
	} finally { await f.close(); }
});

test('A preset request detaches before held initialization and borrows the same Session writer as photo edits', async () => {
	const f = await fixture(), initialization = deferred<void>(), entered = deferred<void>();
	const original = f.base.ports.initialize;
	f.base.ports.initialize = async signal => { entered.resolve(); await initialization.promise; return original(signal); };
	try {
		const request = JSON.parse(JSON.stringify(f.save())) as PhotoLibraryDevelopPresetWriteV1;
		const saving = f.presets.write(request); await entered.promise;
		if (request.command.type !== 'save') throw new Error('Expected save');
		Reflect.set(request.command.preset.identity, 'name', 'Changed after admission');
		await assert.rejects(f.owner.develop.apply({ schemaVersion: 1, photoId: f.base.photos[0]!.id, expectedRevision: 0,
			command: { type: 'record-develop', versionId: 'master', develop: defaultPhotoDevelopV1(), label: 'Concurrent', createdAt: developBatchTime } }), { message: 'A photo library change is already pending.' });
		initialization.resolve();
		assert.equal((await saving).snapshot.presets[0]?.name, 'Evening'); assert.equal(f.base.calls.locks, 2); // Initial recovery, then this one writer.
	} finally { initialization.resolve(); await f.close(); }
});

test('Close joins a held durable preset save and retains its ACK beside a separate lease cleanup failure', async () => {
	const f = await fixture(), entered = deferred<void>(), held = deferred<void>(), failure = Object.freeze({ cleanup: true });
	await f.presets.list({ schemaVersion: 1, catalogId: 'catalog' });
	const put = f.repository.putIfAbsent.bind(f.repository);
	f.repository.putIfAbsent = async (key, value) => { const published = await put(key, value); entered.resolve(); await held.promise; return published; };
	f.base.ports.exclusive = async (_catalog, run, signal) => { await run(signal); throw failure; };
	try {
		const saving = f.presets.write(f.save()); await entered.promise;
		let closed = false; const closing = f.owner.close().then(() => { closed = true; });
		await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(closed, false);
		held.resolve(); const ack = await saving; await closing;
		assert.equal(ack.snapshot.revision, 1); assert.deepEqual(ack.notices, ['cleanup-failed']);
		await assert.rejects(f.presets.list({ schemaVersion: 1, catalogId: 'catalog' }), /closed/iu);
	} finally { held.resolve(); await f.close(); }
});

test('A saved partial body applies through the existing revision-fenced photo history and retains original metadata', async () => {
	const f = await fixture();
	try {
		const packet = f.base.settings.copy({ schemaVersion: 1, develop: { ...defaultPhotoDevelopV1(),
			effects: [createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 2 } }) as VideoEffectLeaf] },
			selection: { effectTypes: ['tone-ladder-v1'], geometry: false, localAdjustments: false } });
		const preset = f.presets.create({ schemaVersion: 1, id: 'partial', name: 'Lift', settings: packet });
		const saved = await f.presets.write({ schemaVersion: 1, catalogId: 'catalog', command: { type: 'save', expectedRevision: 0, preset } });
		assert.equal(saved.snapshot.presets[0]?.scope, 'partial');
		const body = await f.presets.read({ schemaVersion: 1, catalogId: 'catalog', presetId: 'partial', expectedRevision: 1 });
		const target = await f.owner.develop.read({ schemaVersion: 1, photoId: f.base.photos[0]!.id, versionId: 'master' });
		const develop = f.base.settings.merge({ schemaVersion: 1, target: target.develop, settings: body.preset.settings });
		const applied = await f.owner.develop.apply({ schemaVersion: 1, photoId: target.photoId, expectedRevision: target.revision,
			command: { type: 'record-develop', versionId: 'master', develop, label: 'Lift preset', createdAt: developBatchTime } });
		assert.equal(applied.snapshot.develop.effects[0]?.params.exposure, 2); assert.equal(applied.snapshot.history.cursor, 1);
		const photo = (await f.base.repository.loadPhoto('catalog', target.photoId))!;
		assert.deepEqual(photo.original, f.base.photos[0]!.original); assert.deepEqual(photo.metadata, f.base.photos[0]!.metadata);
	} finally { await f.close(); }
});

test('Close joins a held preset read and refuses stale body publication with an opaque caller cancellation unchanged', async () => {
	const f = await fixture(), entered = deferred<void>(), held = deferred<void>(), controller = new AbortController(), reason = Object.freeze({ cancelled: 'read' });
	const readEntry = f.repository.readEntry.bind(f.repository);
	f.repository.readEntry = async key => { entered.resolve(); await held.promise; return readEntry(key); };
	try {
		const reading = f.presets.list({ schemaVersion: 1, catalogId: 'catalog' }, { signal: controller.signal }).catch((error: unknown) => error);
		await entered.promise; controller.abort(reason);
		let closed = false; const closing = f.owner.close().then(() => { closed = true; });
		await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(closed, false);
		held.resolve(); assert.equal(await reading, reason); await closing;
	} finally { held.resolve(); await f.close(); }
});
