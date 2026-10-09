/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { currentDevelopFixture, currentRecipe, CURRENT_TIME } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';

test('current full/partial settings batch uses one writer and retains mixed resource refs and every scalar ACK', async () => {
	const f = await currentDevelopFixture(), settings = f.develop.settings;
	assert.ok(settings);
	try {
		const packet = settings.copy({ schemaVersion: 2, develop: currentRecipe(), selection: { effectTypes: ['cube-lut-profile-v1'], geometry: false, localAdjustments: false } });
		const receipt = await settings.applyBatch({ schemaVersion: 2, catalogId: 'catalog-1', targets: [
			{ photoId: 'photo-1', versionId: 'version-1', expectedRevision: 0 }, { photoId: 'photo-2', versionId: 'version-2', expectedRevision: 3 }],
			action: { kind: 'paste', settings: packet }, label: 'Sync', createdAt: CURRENT_TIME });
		assert.equal(receipt.schemaVersion, 2); assert.deepEqual(receipt.outcomes.map(slot => slot.status), ['applied', 'conflict']);
		assert.equal(f.calls.writer, 1); assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.schemaVersion, 2);
		assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-2'))?.schemaVersion, 1);
		const before = await f.repository.loadPhoto('catalog-1', 'photo-1');
		const neutral = await settings.applyBatch({ schemaVersion: 2, catalogId: 'catalog-1', targets: [{ photoId: 'photo-1', versionId: 'version-1', expectedRevision: 1 }],
			action: { kind: 'relative', effectType: 'tone-ladder-v1', changes: { exposure: 0 } }, label: 'No-op', createdAt: CURRENT_TIME });
		assert.equal(neutral.outcomes[0]?.status, 'unchanged'); assert.deepEqual(await f.repository.loadPhoto('catalog-1', 'photo-1'), before);
	} finally { await f.close(); }
});

test('current serial batch detaches every target and retains first ACK when native cancellation prevents later targets', async () => {
	const f = await currentDevelopFixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	let traps = 0; const reason = new Proxy({}, { get() { traps++; throw Error('Opaque access'); }, getOwnPropertyDescriptor() { traps++; throw Error('Opaque descriptor'); } });
	const save = f.repository.savePhoto;
	f.repository.savePhoto = async function (...args) { const saved = await Reflect.apply(save, f.repository, args); entered.resolve(); await release.promise; return saved; };
	try {
		const request = { schemaVersion: 2 as const, catalogId: 'catalog-1', targets: [
			{ photoId: 'photo-1', versionId: 'version-1', expectedRevision: 0 }, { photoId: 'photo-2', versionId: 'version-2', expectedRevision: 0 }],
			action: { kind: 'relative' as const, effectType: 'tone-ladder-v1' as const, changes: { exposure: 1 } }, label: 'Quick', createdAt: CURRENT_TIME };
		const work = f.develop.settings!.applyBatch(request, { signal: stop.signal }); await entered.promise;
		request.targets[1]!.photoId = 'replacement'; request.action.changes.exposure = 4; stop.abort(reason); release.resolve();
		const receipt = await work; assert.equal(receipt.completion, 'cancelled'); assert.deepEqual(receipt.outcomes.map(slot => slot.status), ['applied', 'not-attempted']);
		assert.equal(receipt.outcomes[1]?.photoId, 'photo-2'); assert.equal(receipt.outcomes[0]?.revision, 1); assert.equal(traps, 0);
		assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.versions[0]?.develop.effects[0]?.params.exposure, 1);
		assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-2'))?.revision, 0);
	} finally { release.resolve(); await f.close(); }
});

test('current batch admits closed unique plans and keeps completed ACK separate from independent cleanup failure', async () => {
	const f = await currentDevelopFixture();
	try {
		const target = { photoId: 'photo-1', versionId: 'version-1', expectedRevision: 0 };
		const request = { schemaVersion: 2 as const, catalogId: 'catalog-1', targets: [target, target], action: {
			kind: 'relative' as const, effectType: 'tone-ladder-v1' as const, changes: { exposure: 1 } }, label: 'Quick', createdAt: CURRENT_TIME };
		await assert.rejects(f.develop.settings!.applyBatch(request), /duplicate/iu); assert.equal(f.calls.writer, 0);
		f.hooks.afterWriter = async () => { throw Object.freeze({ cleanup: true }); };
		const receipt = await f.develop.settings!.applyBatch({ ...request, targets: [target] });
		assert.equal(receipt.completion, 'interrupted'); assert.deepEqual(receipt.notices, ['cleanup-failed']); assert.equal(receipt.outcomes[0]?.status, 'applied');
	} finally { await f.close(); }
});
