/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryDevelopSettingsWorkflowV2, type PhotoDevelopSettingsSourceV2 } from '../src/common/editor/controller/shared/photo-library-develop-settings-workflow-v2.ts';
import type { ExecutePhotoDevelopV2 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-v2.ts';
import type { PhotoLibraryDevelopPortV2 } from '../src/common/editor/photo-library-develop-port-v2.ts';
import { CURRENT_TIME, currentDevelopFixture, currentRecipe } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { createImageDevelopPresetV1 } from '../src/common/editor/imaging/image-develop-preset-v1.ts';
import { copyImageDevelopSettingsV1 } from '../src/common/editor/imaging/image-develop-settings-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

const ALL = { effectTypes: 'all' as const, geometry: true, localAdjustments: true };
async function fixture() {
	const f = await currentDevelopFixture(3); let current = true;
	const execute: ExecutePhotoDevelopV2 = async (run, signal) => { await run({ signal: signal!, acquire: async () => f.develop, isCurrent: () => current, refresh: async () => undefined }); };
	let next = 0; const owner = new PhotoLibraryDevelopSettingsWorkflowV2({ execute, now: () => CURRENT_TIME, createId: () => `preset-${String(++next)}` });
	const before = await f.develop.read({ schemaVersion: 2, photoId: 'photo-1' });
	const source: PhotoDevelopSettingsSourceV2 = { schemaVersion: 2, catalogId: before.catalogId, photoId: before.photoId, versionId: before.versionId,
		revision: before.revision, develop: currentRecipe() };
	return { ...f, owner, execute, source, retire() { current = false; } };
}

test('actual current copy/paste and Sync preserve selected refs, real active versions and native scalar outcomes', async () => {
	const f = await fixture();
	try {
		await f.owner.copy(f.source, { effectTypes: ['cube-lut-profile-v1'], geometry: false, localAdjustments: false });
		assert.equal(f.owner.snapshot().clipboard?.schemaVersion, 2); assert.deepEqual(f.owner.snapshot().clipboard?.develop.effects, currentRecipe().effects);
		const receipt = await f.owner.sync(f.source, ['photo-1', 'photo-2', 'photo-3'], ALL, 'Sync');
		assert.deepEqual(receipt?.outcomes.map(item => item.status), ['applied', 'applied']);
		for (const photoId of ['photo-2', 'photo-3']) { const photo = await f.repository.loadPhoto('catalog-1', photoId); assert.ok(photo);
			assert.equal(photo.schemaVersion, 2); assert.deepEqual(photo.versions[0]?.develop, currentRecipe()); }
		assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.schemaVersion, 1);
		const pasted = await f.owner.paste(f.source, 'Paste'); assert.equal(pasted?.outcomes[0]?.status, 'applied');
	} finally { await f.owner.close(); await f.close(); }
});

test('full/partial current presets preserve refs and selected revision, rename keeps old body1 strict, deletion keeps empty row2', async () => {
	const f = await fixture();
	try {
		await f.owner.listPresets('catalog-1'); await f.owner.savePreset(f.source, ALL, 'Full');
		await f.owner.savePreset(f.source, { effectTypes: ['cube-lut-profile-v1'], geometry: false, localAdjustments: false }, 'Partial');
		const menu = f.owner.snapshot().presets!; assert.equal(menu.schemaVersion, 2); assert.deepEqual(menu.presets.map(item => item.scope), ['full', 'partial']);
		assert.equal('settings' in menu.presets[0]!, false);
		const applied = await f.owner.applyPreset(f.source, 'preset-2', menu.revision, 'Preset'); assert.equal(applied?.outcomes[0]?.status, 'applied');
		const old = createImageDevelopPresetV1({ schemaVersion: 1, id: 'legacy', name: 'Old', settings: copyImageDevelopSettingsV1({ schemaVersion: 1, develop: defaultImageDevelopStateV1(), selection: ALL }) });
		await f.develop.presets!.write({ schemaVersion: 2, catalogId: 'catalog-1', command: { type: 'save', expectedRevision: menu.revision, preset: old } });
		await f.owner.listPresets('catalog-1'); const revision = f.owner.snapshot().presets!.revision;
		await f.owner.renamePreset('catalog-1', 'legacy', revision, 'Renamed');
		const renamed = await f.develop.presets!.read({ schemaVersion: 2, catalogId: 'catalog-1', presetId: 'legacy', expectedRevision: revision + 1 });
		assert.equal(renamed.preset.schemaVersion, 1); assert.deepEqual(renamed.preset.settings, old.settings); assert.equal(renamed.preset.identity.authoredStateSha256, old.identity.authoredStateSha256);
		await f.owner.deletePreset('catalog-1', 'legacy', revision); assert.ok(f.owner.snapshot().error);
		for (const id of ['preset-1', 'preset-2', 'legacy']) await f.owner.deletePreset('catalog-1', id, f.owner.snapshot().presets!.revision);
		assert.equal(f.owner.snapshot().presets?.presets.length, 0);
		const raw = await f.settings.readEntry(photoDevelopPresetsKeyV1('catalog-1')); assert.equal(raw.present, true);
		if (raw.present) assert.equal((raw.value as { schemaVersion: number }).schemaVersion, 2);
	} finally { await f.owner.close(); await f.close(); }
});

test('Auto-sync follows acknowledged source separately and advances only complete companion fences', async () => {
	const f = await fixture();
	try {
		await f.owner.armAutoSync(f.source, ['photo-1', 'photo-2'], ALL);
		const sourceAck = await f.develop.apply({ schemaVersion: 2, photoId: 'photo-1', expectedRevision: f.source.revision,
			command: { type: 'record-develop', versionId: f.source.versionId, develop: currentRecipe(null), label: 'Source', createdAt: CURRENT_TIME } });
		const receipt = await f.owner.syncAcknowledged({ ...f.source, revision: sourceAck.snapshot.revision, develop: sourceAck.snapshot.develop }, 'Auto');
		assert.equal(receipt?.outcomes[0]?.photoId, 'photo-2'); assert.equal(sourceAck.snapshot.revision, f.source.revision + 1);
		const second = await f.owner.syncAcknowledged({ ...f.source, revision: sourceAck.snapshot.revision, develop: currentRecipe() }, 'Auto');
		assert.equal(second?.outcomes[0]?.status, 'applied');
		await f.owner.relative('catalog-1', ['photo-2'], 'tone-ladder-v1', { exposure: 0.5 }, 'Quick');
		const conflict = await f.owner.syncAcknowledged({ ...f.source, revision: sourceAck.snapshot.revision, develop: currentRecipe(null) }, 'Auto');
		assert.equal(conflict?.outcomes[0]?.status, 'conflict'); assert.equal(f.owner.snapshot().autoSync, false);
		assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.revision, sourceAck.snapshot.revision);
	} finally { await f.owner.close(); await f.close(); }
});

test('source refs and selection detach before acquire and Cancel joins a held target without batch publication', async () => {
	const f = await fixture(), held = deferred<PhotoLibraryDevelopPortV2>(); let acquired = 0;
	const owner = new PhotoLibraryDevelopSettingsWorkflowV2({ execute: async (run, signal) => { await run({ signal: signal!, acquire: () => { acquired++; return held.promise; }, isCurrent: () => true, refresh: async () => undefined }); } });
	try {
		const value = { ...f.source, develop: JSON.parse(JSON.stringify(currentRecipe())) as ReturnType<typeof currentRecipe> };
		const work = owner.copy(value, ALL); Reflect.set(value.develop.effects[0]!.params.lut as object, 'storageKey', 'changed');
		await owner.copy(f.source, ALL); assert.equal(acquired, 1); held.resolve(f.develop); await work;
		assert.deepEqual(owner.snapshot().clipboard?.develop.effects, currentRecipe().effects);
		const reading = deferred<ReturnType<typeof f.develop.read> extends Promise<infer Result> ? Result : never>();
		const port = { ...f.develop, read: () => reading.promise };
		const stopped = new PhotoLibraryDevelopSettingsWorkflowV2({ execute: async (run, signal) => { await run({ signal: signal!, acquire: async () => port, isCurrent: () => true, refresh: async () => undefined }); } });
		const sync = stopped.sync(f.source, ['photo-2'], ALL, 'Sync'); await settle(); const cancellation = stopped.cancel(); await remainsPending(cancellation);
		reading.resolve(await f.develop.read({ schemaVersion: 2, photoId: 'photo-2' })); await sync; await cancellation; assert.equal(stopped.snapshot().batch, null); await stopped.close();
	} finally { held.resolve(f.develop); await owner.close(); await f.owner.close(); await f.close(); }
});

test('actual batch ACK survives late Cancel and distinct writer cleanup with notices and original bytes intact', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	f.hooks.afterWriter = async () => { entered.resolve(); await release.promise; throw new Error('Distinct writer cleanup'); };
	try {
		const work = f.owner.relative('catalog-1', ['photo-2', 'photo-3'], 'tone-ladder-v1', { exposure: 0.5 }, 'Quick');
		await entered.promise; const cancellation = f.owner.cancel(); await remainsPending(cancellation);
		release.resolve(); const receipt = await work; await cancellation;
		assert.equal(receipt?.completion, 'interrupted'); assert.deepEqual(receipt?.outcomes.map(outcome => outcome.status), ['applied', 'applied']);
		assert.deepEqual(receipt?.notices, ['cleanup-failed']); assert.equal(f.owner.snapshot().batch, receipt); assert.equal(f.owner.snapshot().notice, 'refresh-failed');
		for (const photoId of ['photo-2', 'photo-3']) {
			const photo = await f.repository.loadPhoto('catalog-1', photoId); assert.equal(photo?.revision, f.photos[0]!.revision + 1);
			assert.deepEqual(photo?.original, f.photos.find(before => before.id === photoId)?.original);
		}
	} finally { release.resolve(); await f.owner.close(); await f.close(); }
});

test('actual scalar batch ACK survives a failing borrowed currentness callback', async () => {
	const f = await fixture(); let acknowledged = false;
	const failure = new Proxy({}, { get() { throw new Error('Opaque failure inspected'); }, getOwnPropertyDescriptor() { throw new Error('Opaque failure inspected'); } });
	const port = { ...f.develop, settings: { ...f.develop.settings!, applyBatch: async (...args: Parameters<NonNullable<PhotoLibraryDevelopPortV2['settings']>['applyBatch']>) => {
		const receipt = await f.develop.settings!.applyBatch(...args); acknowledged = true; return receipt;
	} } };
	const owner = new PhotoLibraryDevelopSettingsWorkflowV2({ execute: async (run, signal) => { await run({ signal: signal!, acquire: async () => port,
		isCurrent: () => { if (acknowledged) throw failure; return true; }, refresh: async () => undefined }); }, now: () => CURRENT_TIME });
	try {
		const receipt = await owner.relative('catalog-1', ['photo-2'], 'tone-ladder-v1', { exposure: 0.5 }, 'Quick');
		assert.equal(acknowledged, true); assert.equal(receipt?.outcomes[0]?.status, 'applied');
		assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-2'))?.revision, receipt?.outcomes[0]?.revision);
	} finally { await owner.close(); await f.owner.close(); await f.close(); }
});

test('a durable preset ACK survives Close while the retired scalar menu stays unchanged', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	try {
		await f.owner.listPresets('catalog-1'); const before = f.owner.snapshot().presets;
		f.hooks.afterWriter = async () => { entered.resolve(); await release.promise; throw new Error('Preset writer cleanup'); };
		const work = f.owner.savePreset(f.source, ALL, 'Saved'); await entered.promise;
		const closing = f.owner.close(); assert.equal(f.owner.close(), closing); await remainsPending(closing);
		release.resolve(); const receipt = await work; await closing;
		assert.equal(receipt?.snapshot.presets[0]?.name, 'Saved'); assert.deepEqual(receipt?.notices, ['cleanup-failed']);
		assert.equal(f.owner.snapshot().presets, before); assert.equal(f.owner.snapshot().presetReceipt, null);
		assert.equal((await f.develop.presets!.list({ schemaVersion: 2, catalogId: 'catalog-1' })).presets[0]?.name, 'Saved');
	} finally { release.resolve(); await f.owner.close(); await f.close(); }
});

test('preset body binds the captured digest and a held read joins Close without inspecting the late body', async () => {
	const f = await fixture(), held = deferred<Awaited<ReturnType<NonNullable<PhotoLibraryDevelopPortV2['presets']>['read']>>>();
	let holding = false, batches = 0, traps = 0;
	try {
		await f.owner.listPresets('catalog-1'); await f.owner.savePreset(f.source, ALL, 'Saved');
		const capability = f.develop.presets!, body = await capability.read({ schemaVersion: 2, catalogId: 'catalog-1', presetId: 'preset-1', expectedRevision: 1 });
		const alternative = capability.create({ schemaVersion: 2, id: 'preset-1', name: 'Saved', settings: f.develop.settings!.copy({ schemaVersion: 2, develop: currentRecipe(null), selection: ALL }) });
		const port: PhotoLibraryDevelopPortV2 = { ...f.develop,
			presets: { ...capability, read: async request => { assert.deepEqual(request, { schemaVersion: 2, catalogId: 'catalog-1', presetId: 'preset-1', expectedRevision: 1 }); return holding ? held.promise : { ...body, preset: alternative }; } },
			settings: { ...f.develop.settings!, applyBatch: async (...args) => { batches++; return f.develop.settings!.applyBatch(...args); } },
		};
		const owner = new PhotoLibraryDevelopSettingsWorkflowV2({ execute: async (run, signal) => { await run({ signal: signal!, acquire: async () => port, isCurrent: () => true, refresh: async () => undefined }); } });
		try {
			await owner.listPresets('catalog-1'); assert.equal(await owner.applyPreset(f.source, 'preset-1', 1, 'Apply'), null); assert.ok(owner.snapshot().error); assert.equal(batches, 0);
			holding = true; const work = owner.applyPreset(f.source, 'preset-1', 1, 'Apply'); await settle(); const closing = owner.close(); await remainsPending(closing);
			held.resolve(new Proxy(body, { get(_target, key) { if (key === 'then') return undefined; traps++; throw new Error('Late body inspected'); } })); await work; await closing;
			assert.equal(traps, 0); assert.equal(batches, 0);
		} finally { held.resolve(body); await owner.close(); }
	} finally { await f.owner.close(); await f.close(); }
});

test('current source admission rejects schema1 and synchronous Close before execution', async () => {
	const f = await fixture(); let executions = 0, closing: Promise<void> | null = null;
	const owner = new PhotoLibraryDevelopSettingsWorkflowV2({ execute: async (run, signal) => { executions++; await f.execute(run, signal); } });
	try {
		await owner.copy({ ...f.source, schemaVersion: 1 } as never, ALL); assert.equal(executions, 0); assert.ok(owner.snapshot().error);
		const value = new Proxy(f.source, { ownKeys(target) { closing = owner.close(); return Reflect.ownKeys(target); } });
		await owner.copy(value, ALL); assert.ok(closing); await closing; assert.equal(executions, 0); assert.equal(owner.snapshot().clipboard, null);
	} finally { await owner.close(); await f.owner.close(); await f.close(); }
});

test('settings currentness native-aborts before acquiring or reflecting the current capability', async () => {
	const f = await fixture(), stop = new AbortController(); let acquired = 0, traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw new Error('Native reason inspected'); }, getOwnPropertyDescriptor() { traps++; throw new Error('Native reason inspected'); } });
	const owner = new PhotoLibraryDevelopSettingsWorkflowV2({ execute: async run => { await run({ signal: stop.signal,
		acquire: async () => { acquired++; return f.develop; }, isCurrent: () => { stop.abort(reason); return true; }, refresh: async () => undefined }); } });
	try { await owner.copy(f.source, ALL); assert.equal(acquired, 0); assert.equal(traps, 0); assert.equal(owner.snapshot().clipboard, null); }
	finally { await owner.close(); await f.owner.close(); await f.close(); }
});

test('Close from the batch clock refuses writer admission after target reads', async () => {
	const f = await fixture(); let writes = 0, closing: Promise<void> | null = null;
	const port = { ...f.develop, settings: { ...f.develop.settings!, applyBatch: async (...args: Parameters<NonNullable<PhotoLibraryDevelopPortV2['settings']>['applyBatch']>) => { writes++; return f.develop.settings!.applyBatch(...args); } } };
	const owner = new PhotoLibraryDevelopSettingsWorkflowV2({ execute: async (run, signal) => { await run({ signal: signal!, acquire: async () => port, isCurrent: () => true, refresh: async () => undefined }); },
		now: () => { closing = owner.close(); return CURRENT_TIME; } });
	try {
		await owner.relative('catalog-1', ['photo-2'], 'tone-ladder-v1', { exposure: 0.5 }, 'Quick');
		assert.ok(closing); await closing; assert.equal(writes, 0); assert.equal(f.calls.writer, 0);
	} finally { await owner.close(); await f.owner.close(); await f.close(); }
});
