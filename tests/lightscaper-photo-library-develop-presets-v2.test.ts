/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { currentDevelopFixture, currentRecipe } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { createPhotoLibraryDevelopSessionV2 } from '../src/lightscaper/controller/photo-library-develop-session-v2.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

test('current preset host authenticates detached full body under the borrowed writer and retains ACK beside cleanup notice', async () => {
	const f = await currentDevelopFixture(), presets = f.develop.presets; assert.ok(presets);
	try {
		const packet = f.develop.settings!.copy({ schemaVersion: 2, develop: currentRecipe(), selection: { effectTypes: 'all', geometry: true, localAdjustments: true } });
		const preset = presets.create({ schemaVersion: 2, id: 'lut', name: 'LUT', settings: packet });
		f.hooks.afterWriter = async () => { throw Object.freeze({ cleanup: true }); };
		const ack = await presets.write({ schemaVersion: 2, catalogId: 'catalog-1', command: { type: 'save', expectedRevision: 0, preset } });
		assert.equal(ack.snapshot.schemaVersion, 2); assert.deepEqual(ack.notices, ['cleanup-failed']); assert.equal(f.calls.resources, 1);
		const body = await presets.read({ schemaVersion: 2, catalogId: 'catalog-1', presetId: 'lut', expectedRevision: 1 });
		assert.deepEqual(body.preset, preset); assert.deepEqual(presets.parse(presets.serialize(body.preset)), preset);
		assert.deepEqual((await f.repository.loadPhoto('catalog-1', 'photo-1')), f.photos[0]);
	} finally { await f.close(); }
});

test('preset host pins read/write/verifier receivers before held initialization and detaches selected body before the writer', async () => {
	const f = await currentDevelopFixture(), entered = deferred<void>(), release = deferred<void>(); let traps = 0, calls = 0;
	const verify = new Proxy(async function(this: unknown, body: unknown, signal?: AbortSignal) {
		assert.equal(this, f.storage); calls++; assert.equal((body as { identity: { name: string } }).identity.name, 'Before'); signal?.throwIfAborted();
	}, { get() { traps++; throw Error('Borrowed verifier metadata'); } });
	f.storage.verifyResources = verify;
	const develop = createPhotoLibraryDevelopSessionV2(f.host), presets = develop.presets!;
	f.hooks.ready = async () => { entered.resolve(); await release.promise; return 'catalog-1'; };
	const preset = structuredClone(presets.create({ schemaVersion: 2, id: 'pinned', name: 'Before', settings: develop.settings!.copy({
		schemaVersion: 2, develop: currentRecipe(), selection: { effectTypes: 'all', geometry: true, localAdjustments: true } }) }));
	const work = presets.write({ schemaVersion: 2, catalogId: 'catalog-1', command: { type: 'save', expectedRevision: 0, preset } }); await entered.promise;
	try {
		Reflect.set(preset.identity, 'name', 'After'); f.storage.verifyResources = async () => { throw Error('Replacement verifier'); };
		f.settings.readEntry = async () => { throw Error('Replacement read'); }; f.settings.putIfAbsent = async () => { throw Error('Replacement put'); };
		release.resolve(); assert.equal((await work).snapshot.presets[0]?.name, 'Before'); assert.equal(calls, 1); assert.equal(traps, 0);
	} finally { release.resolve(); await f.close(); }
});

test('held preset body verification joins Close and cancellation without publishing or inspecting opaque reasons', async () => {
	const f = await currentDevelopFixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	let traps = 0; const reason = new Proxy({}, { get() { traps++; throw Error('Opaque get'); }, getOwnPropertyDescriptor() { traps++; throw Error('Opaque descriptor'); } });
	f.hooks.verifyPreset = async (_preset, signal) => { entered.resolve(); await release.promise; signal?.throwIfAborted(); };
	const preset = f.develop.presets!.create({ schemaVersion: 2, id: 'held', name: 'Held', settings: f.develop.settings!.copy({
		schemaVersion: 2, develop: currentRecipe(), selection: { effectTypes: 'all', geometry: true, localAdjustments: true } }) });
	const work = f.develop.presets!.write({ schemaVersion: 2, catalogId: 'catalog-1', command: { type: 'save', expectedRevision: 0, preset } }, { signal: stop.signal });
	const refused = work.then(() => ({ error: undefined }), error => ({ error: error as unknown })); await entered.promise; stop.abort(reason);
	const closing = f.close(); assert.equal(await remainsPending(closing), true); release.resolve();
	assert.equal((await refused).error === reason, true); await closing; assert.equal(traps, 0);
	assert.equal((await f.settings.readEntry('photo-library:develop-presets:v1:catalog-1')).present, false);
});
