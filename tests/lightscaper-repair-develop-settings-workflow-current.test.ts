/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryDevelopSettingsWorkflowV2 } from '../src/common/editor/controller/shared/photo-library-develop-settings-workflow-v2.ts';
import { PhotoLibraryDevelopSettingsWorkflowCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-settings-workflow-current-v1.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { createVideoEffectV2 } from '../src/common/editor/video-effects-v2.ts';
import { repairSettingsFixture, brushSettingsRecipe, FULL_SETTINGS_SELECTION, SETTINGS_TIME } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

type Fixture = Awaited<ReturnType<typeof repairSettingsFixture>>;
function workflow(f: Fixture) {
	return new PhotoLibraryDevelopSettingsWorkflowCurrentV1({ execute: f.execute, now: () => SETTINGS_TIME });
}
function invoke(owner: PhotoLibraryDevelopSettingsWorkflowCurrentV1, method: 'copy' | 'paste' | 'sync' | 'relative' | 'armAutoSync' | 'syncAcknowledged', ...args: unknown[]) {
	return Reflect.apply(owner[method], owner, args) as Promise<unknown>;
}
async function source(f: Fixture, index = 0, develop?: unknown) {
	const document = await f.read(index);
	return { schemaVersion: 3 as const, catalogId: document.catalogId, photoId: document.photoId, versionId: document.versionId,
		revision: document.revision, develop: develop === undefined ? document.develop : normalizeImageDevelopStateCurrentV1(develop) };
}
async function assertCustody(f: Fixture, before: Awaited<ReturnType<Fixture['inspect']>>) {
	const after = await f.inspect();
	for (const [index, entry] of after.entries()) {
		assert.deepEqual(entry.bytes, before[index]!.bytes); assert.deepEqual(entry.photo.original, before[index]!.photo.original);
		assert.deepEqual(entry.photo.metadata, before[index]!.photo.metadata); assert.deepEqual(entry.photo.extractedMetadata, before[index]!.photo.extractedMetadata);
	}
}

test('Current Copy awaits the selected native source and keeps the complete dirty repair packet across menu retirement', async () => {
	const f = await repairSettingsFixture(), owner = workflow(f), before = await f.inspect();
	try {
		const original = await f.read(); assert.equal(original.develop.processVersion, 3);
		const dirty = normalizeImageDevelopStateCurrentV1({ ...original.develop, effects: [createVideoEffectV2('tone-ladder-v1', { id: 'tone', params: { exposure: .5 } })] });
		await invoke(owner, 'copy', await source(f, 0, dirty), FULL_SETTINGS_SELECTION);
		const packet = owner.snapshot().clipboard; assert.ok(packet, 'The actual Current copy must publish a complete packet.');
		assert.equal(packet.schemaVersion, 3); assert.deepEqual(packet.develop, dirty); assert.deepEqual(await f.inspect(), before);
		await owner.dismiss(); owner.resume(); assert.equal(owner.snapshot().clipboard, packet, 'The selected packet identity survives closing and reopening Develop.');
	} finally { await owner.close(); await f.close(); }
});

test('Current Paste promotes a real legacy target, retains repair history, and repeats as a native no-op', async () => {
	const f = await repairSettingsFixture(), owner = workflow(f), before = await f.inspect();
	try {
		const original = await f.read(); assert.equal((await f.read(1)).develop.processVersion, 2);
		await invoke(owner, 'copy', await source(f), FULL_SETTINGS_SELECTION);
		const receipt = await invoke(owner, 'paste', await source(f, 1), 'Paste repairs'); assert.ok(receipt);
		const target = await f.read(1); assert.equal(target.schemaVersion, 3); assert.equal(target.develop.processVersion, 3);
		assert.deepEqual(target.develop, original.develop); assert.equal(target.revision, before[1]!.photo.revision + 1);
		assert.equal((await f.inspect())[1]!.photo.schemaVersion, 3);
		const rows = await f.inspect(); await invoke(owner, 'paste', await source(f, 1), 'Same repairs'); assert.deepEqual(await f.inspect(), rows);
		assert.equal(owner.snapshot().batch?.outcomes[0]?.status, 'unchanged'); await assertCustody(f, before);
	} finally { await owner.close(); await f.close(); }
});

test('Current Sync excludes the source and Quick develop changes parameters while preserving target repair metadata', async () => {
	const f = await repairSettingsFixture(), owner = workflow(f), before = await f.inspect();
	try {
		await invoke(owner, 'sync', await source(f), f.photos.map(photo => photo.id), FULL_SETTINGS_SELECTION, 'Sync repairs');
		assert.equal(owner.snapshot().batch?.outcomes.length, 1); assert.equal(owner.snapshot().batch?.outcomes[0]?.photoId, f.photos[1]!.id);
		assert.deepEqual((await f.read(1)).develop, (await f.read()).develop); assert.deepEqual((await f.inspect())[0], before[0]);
		const repairs = Reflect.get((await f.read(1)).develop, 'repairs');
		await invoke(owner, 'relative', f.photos[0]!.catalogId, [f.photos[1]!.id], 'tone-ladder-v1', { exposure: .5 }, 'Quick target');
		const target = await f.read(1); assert.equal(target.develop.effects.find(effect => effect.type === 'tone-ladder-v1')?.params.exposure, .5);
		assert.deepEqual(Reflect.get(target.develop, 'repairs'), repairs); assert.deepEqual((await f.inspect())[0], before[0]); await assertCustody(f, before);
	} finally { await owner.close(); await f.close(); }
});

test('Current Auto-sync arms without writes, synchronizes a genuine source ACK, and keeps native target revisions for the next ACK', async () => {
	const f = await repairSettingsFixture(), owner = workflow(f), before = await f.inspect();
	try {
		await invoke(owner, 'armAutoSync', await source(f), f.photos.map(photo => photo.id), FULL_SETTINGS_SELECTION);
		assert.equal(owner.snapshot().autoSync, true); assert.deepEqual(await f.inspect(), before);
		for (const exposure of [.25, .5]) {
			const document = await f.read(), develop = normalizeImageDevelopStateCurrentV1({ ...document.develop,
				effects: [createVideoEffectV2('tone-ladder-v1', { id: 'tone', params: { exposure } })] });
			const ack = await f.record(develop); assert.equal(ack.schemaVersion, 3);
			await invoke(owner, 'syncAcknowledged', await source(f), 'Auto-sync ACK');
			assert.deepEqual((await f.read(1)).develop, ack.snapshot.develop); assert.equal(owner.snapshot().autoSync, true);
		}
		assert.equal((await f.read(1)).revision, before[1]!.photo.revision + 2); assert.equal(f.saved.length, 4, 'Two source ACKs and two target ACKs have no recursive synchronization.');
		owner.clearAutoSync(); await assertCustody(f, before);
	} finally { await owner.close(); await f.close(); }
});

test('Current selected brush Copy retains its authenticated packet identity through Paste and refuses corrupt unused retained resources', async () => {
	const f = await repairSettingsFixture(), owner = workflow(f);
	try {
		const installed = await f.installBrush(), recipe = brushSettingsRecipe(installed.reference); await f.record(recipe);
		const before = await f.inspect(); await invoke(owner, 'copy', await source(f), FULL_SETTINGS_SELECTION);
		const packet = owner.snapshot().clipboard; assert.ok(packet); assert.equal(packet.schemaVersion, 3);
		assert.equal(packet.develop.masks[0]?.inputs[0]?.sourceRef, installed.reference.storageKey);
		assert.ok(f.borrowed.length > 0); assert.ok(f.borrowed.every(bytes => bytes.every(value => value === 0)));
		await owner.dismiss(); owner.resume(); assert.equal(owner.snapshot().clipboard, packet);
		await invoke(owner, 'paste', await source(f, 1), 'Selected brush paste'); assert.ok(owner.snapshot().batch);
		assert.equal((await f.read(1)).develop.masks[0]?.inputs[0]?.sourceRef, installed.reference.storageKey); await assertCustody(f, before);
		const captured = await source(f); await f.corruptBrush(installed.reference); const previous = owner.snapshot().clipboard, rows = await f.inspect();
		await invoke(owner, 'copy', captured, FULL_SETTINGS_SELECTION);
		assert.equal(owner.snapshot().clipboard, previous); assert.ok(owner.snapshot().error, 'An unused declared body is independently authenticated before Copy publication.');
		assert.deepEqual(await f.inspect(), rows);
	} finally { await owner.close(); await f.close(); }
});

test('Current Copy Close joins the held genuine brush borrower, wipes its body, and publishes no retired clipboard', async () => {
	const f = await repairSettingsFixture(), owner = workflow(f), entered = deferred<void>(), release = deferred<void>();
	const joining: { work?: Promise<unknown>; closing?: Promise<void> } = {}; let bytes: Uint8Array | undefined;
	try {
		const installed = await f.installBrush(); await f.record(brushSettingsRecipe(installed.reference)); const before = await f.inspect();
		f.hooks.borrowedBrush = async (_reference, body) => { bytes = body; entered.resolve(); await release.promise; };
		joining.work = invoke(owner, 'copy', await source(f), FULL_SETTINGS_SELECTION);
		assert.equal(await Promise.race([entered.promise.then(() => true), joining.work.then(() => false)]), true, 'The actual selected body must be borrowed before Copy can publish.');
		assert.ok(bytes?.some(value => value !== 0)); joining.closing = owner.close(); assert.equal(owner.close(), joining.closing);
		assert.equal(await remainsPending(joining.closing), true); assert.equal(owner.snapshot().clipboard, null);
		release.resolve(); await joining.work; await joining.closing;
		assert.ok(bytes?.every(value => value === 0)); assert.equal(owner.snapshot().clipboard, null); assert.deepEqual(await f.inspect(), before);
	} finally { release.resolve(); await joining.work; await joining.closing; await owner.close(); await f.close(); }
});

test('the permanent legacy Develop and settings source still refuse a retained Photo3 before copying', async () => {
	const f = await repairSettingsFixture(), owner = workflow(f);
	try {
		const before = await f.inspect(); await assert.rejects(f.session.legacyDevelop!.read({ schemaVersion: 2, photoId: f.photos[0]!.id }));
		const legacy = new PhotoLibraryDevelopSettingsWorkflowV2({ execute: async () => assert.fail('Source3 cannot enter a legacy acquisition.') });
		try { await (Reflect.apply(legacy.copy, legacy, [await source(f), FULL_SETTINGS_SELECTION]) as Promise<unknown>); assert.equal(legacy.snapshot().clipboard, null); assert.ok(legacy.snapshot().error); }
		finally { await legacy.close(); }
		assert.deepEqual(await f.inspect(), before);
	} finally { await owner.close(); await f.close(); }
});
