/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryDevelopSettingsWorkflowV1, type PhotoDevelopSettingsSourceV1 } from '../src/common/editor/controller/shared/photo-library-develop-settings-workflow-v1.ts';
import type { PhotoLibraryDevelopPortV1, PhotoLibraryDevelopSnapshotV1 } from '../src/common/editor/photo-library-develop-port-v1.ts';
import type { PhotoLibraryDevelopBatchRequestV1, PhotoLibraryDevelopBatchReceiptV1 } from '../src/common/editor/photo-library-develop-settings-port-v1.ts';
import type { PhotoLibraryDevelopPresetBodyV1, PhotoLibraryDevelopPresetWriteV1 } from '../src/common/editor/photo-library-develop-presets-port-v1.ts';
import { copyImageDevelopSettingsV1, mergeImageDevelopSettingsV1, adjustImageDevelopSettingsV1 } from '../src/common/editor/imaging/image-develop-settings-v1.ts';
import { createImageDevelopPresetV1, parseImageDevelopPresetV1, serializeImageDevelopPresetV1 } from '../src/common/editor/imaging/image-develop-preset-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import type { VideoEffectLeaf } from '../src/common/editor/project-media-types.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

const all = { effectTypes: 'all' as const, geometry: true, localAdjustments: true };
function source(): PhotoDevelopSettingsSourceV1 {
	return { catalogId: 'catalog', photoId: 'photo', versionId: 'master', revision: 7,
		develop: { ...defaultImageDevelopStateV1(), effects: [createVideoEffect('white-balance-v1', { id: 'wb', params: { temperature: 0.25 } }) as VideoEffectLeaf,
			createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } }) as VideoEffectLeaf] } };
}
function host() {
	const batches: PhotoLibraryDevelopBatchRequestV1[] = [], reads: string[] = [], writes: PhotoLibraryDevelopPresetWriteV1[] = [];
	let menuRevision = 0, acquired = 0, refreshes = 0, current = true, bodyReads = 0;
	const bodies = new Map<string, ReturnType<typeof createImageDevelopPresetV1>>();
	const menu = () => ({ schemaVersion: 1 as const, catalogId: 'catalog', revision: menuRevision,
		presets: [...bodies.values()].map(preset => ({ ...preset.identity, scope: preset.settings.selection.effectTypes === 'all' && preset.settings.selection.geometry && preset.settings.selection.localAdjustments ? 'full' as const : 'partial' as const })) });
	const port: { -readonly [Key in keyof PhotoLibraryDevelopPortV1]: PhotoLibraryDevelopPortV1[Key] } = {
		read: async request => { reads.push(request.photoId); return { schemaVersion: 1, photoId: request.photoId, revision: 12, versionId: 'alternate', activeVersionId: 'alternate',
			develop: defaultImageDevelopStateV1(), versions: [], history: { cursor: 0, entries: [] }, snapshots: [] } satisfies PhotoLibraryDevelopSnapshotV1; },
		apply: async () => { throw new Error('Settings batches use the existing batch writer.'); },
		settings: { copy: copyImageDevelopSettingsV1, merge: mergeImageDevelopSettingsV1, adjust: adjustImageDevelopSettingsV1,
			applyBatch: async request => { batches.push(request); return receipt(request); } },
		presets: { create: createImageDevelopPresetV1, parse: parseImageDevelopPresetV1, serialize: serializeImageDevelopPresetV1,
			list: async () => menu(), read: async request => { bodyReads++; assert.equal(request.expectedRevision, menuRevision);
				return { schemaVersion: 1, catalogId: 'catalog', revision: menuRevision, preset: bodies.get(request.presetId)! }; },
			write: async request => { writes.push(request); assert.equal(request.command.expectedRevision, menuRevision);
				if (request.command.type === 'save') bodies.set(request.command.preset.identity.id, request.command.preset); else bodies.delete(request.command.presetId);
				menuRevision++; return { snapshot: menu(), notices: [] }; } },
	};
	const owner = new PhotoLibraryDevelopSettingsWorkflowV1({ execute: async (run, signal) => {
		await run({ signal: signal!, acquire: async () => { acquired++; return port; }, isCurrent: () => current, refresh: async () => { refreshes++; } });
	}, now: () => '2026-10-09T00:00:00.000Z', createId: () => 'look' });
	return { owner, port, batches, reads, writes, bodies, get acquired() { return acquired; }, get refreshes() { return refreshes; },
		get bodyReads() { return bodyReads; }, retire() { current = false; } };
}
function receipt(request: PhotoLibraryDevelopBatchRequestV1): PhotoLibraryDevelopBatchReceiptV1 {
	return { schemaVersion: 1, catalogId: request.catalogId, completion: 'finished', notices: [], outcomes: request.targets.map((target, index) => ({
		index, ...target, status: 'applied', revision: target.expectedRevision + 1, historyCursor: 1, code: null })) };
}

test('copy picker retains only selected settings and Paste names the exact current version and revision', async () => {
	const h = host(); await h.owner.copy(source(), { ...all, effectTypes: ['white-balance-v1'], geometry: false, localAdjustments: false });
	assert.deepEqual(h.owner.snapshot().clipboard?.develop.effects.map(effect => effect.type), ['white-balance-v1']);
	await h.owner.paste(source(), 'Paste'); assert.deepEqual(h.batches[0]?.targets, [{ photoId: 'photo', versionId: 'master', expectedRevision: 7 }]);
	assert.equal(h.batches[0]?.action.kind, 'paste'); assert.equal(h.refreshes, 1); await h.owner.close();
});

test('Sync and relative Quick develop resolve selected active versions serially, then retain scalar per-target outcomes', async () => {
	const h = host(); await h.owner.sync(source(), ['photo', 'other', 'third'], all, 'Sync');
	assert.deepEqual(h.reads, ['other', 'third']); assert.deepEqual(h.batches[0]?.targets.map(target => target.versionId), ['alternate', 'alternate']);
	await h.owner.relative('catalog', ['other'], 'tone-ladder-v1', { exposure: 0.5 }, 'Quick');
	assert.deepEqual(h.batches[1]?.action, { kind: 'relative', effectType: 'tone-ladder-v1', changes: { exposure: 0.5 } });
	assert.equal(h.owner.snapshot().batch?.outcomes[0]?.revision, 13); await h.owner.close();
});

test('Auto-sync captures the plan once; source ACK cannot reset its revision fences or be erased by partial target ACKs', async () => {
	const h = host(); await h.owner.armAutoSync(source(), ['photo', 'other'], all); const original = source();
	await h.owner.syncAcknowledged({ ...original, revision: 8 }, 'Auto-sync');
	assert.deepEqual(h.batches[0]?.targets, [{ photoId: 'other', versionId: 'alternate', expectedRevision: 12 }]);
	await h.owner.syncAcknowledged({ ...original, revision: 9 }, 'Auto-sync');
	assert.equal(h.batches[1]?.targets[0]?.expectedRevision, 13); assert.deepEqual(h.reads, ['other']);
	h.owner.clearAutoSync(); await h.owner.syncAcknowledged({ ...original, revision: 10 }, 'Auto-sync'); assert.equal(h.batches.length, 2); await h.owner.close();
});

test('complete settings and selected identities detach before held acquisition; overlapping demand and getters refuse cold', async () => {
	const h = host(), held = deferred<PhotoLibraryDevelopPortV1>(); let acquire = 0;
	const owner = new PhotoLibraryDevelopSettingsWorkflowV1({ execute: async (run, signal) => {
		await run({ signal: signal!, acquire: () => { acquire++; return held.promise; }, isCurrent: () => true, refresh: async () => undefined });
	} });
	const value = source(), work = owner.copy(value, all); Reflect.set(value.develop.effects[0]!.params, 'temperature', 0.9);
	await owner.copy(source(), all); assert.equal(acquire, 1); held.resolve(h.port); await work;
	assert.equal(owner.snapshot().clipboard?.develop.effects[0]?.params.temperature, 0.25);
	let traps = 0; await owner.copy(Object.defineProperty(source(), 'photoId', { get() { traps++; return 'photo'; } }), all);
	assert.equal(traps, 0); assert.equal(acquire, 1); await Promise.all([owner.close(), h.owner.close()]);
});

test('Cancel joins held reads and blocks writer admission; Close joins returned late ACK but suppresses retired state', async () => {
	const h = host(), held = deferred<PhotoLibraryDevelopSnapshotV1>(); h.port.read = () => held.promise;
	const work = h.owner.sync(source(), ['other'], all, 'Sync'); await settle(); let joined = false;
	const cancel = h.owner.cancel().then(() => { joined = true; }); await settle(); assert.equal(joined, false);
	held.resolve({ schemaVersion: 1, photoId: 'other', revision: 12, versionId: 'alternate', activeVersionId: 'alternate', develop: defaultImageDevelopStateV1(), versions: [], history: { cursor: 0, entries: [] }, snapshots: [] });
	await Promise.all([work, cancel]); assert.equal(h.batches.length, 0);
	const written = deferred<PhotoLibraryDevelopBatchReceiptV1>(); h.port.settings = { ...h.port.settings!, applyBatch: () => written.promise };
	await h.owner.copy(source(), all); const paste = h.owner.paste(source(), 'Paste'); await settle(); const closing = h.owner.close();
	written.resolve(receipt({ schemaVersion: 1, catalogId: 'catalog', targets: [{ photoId: 'photo', versionId: 'master', expectedRevision: 7 }], action: { kind: 'paste', settings: h.owner.snapshot().clipboard! }, label: 'Paste', createdAt: '2026-10-09T00:00:00.000Z' }));
	assert.equal((await paste)?.outcomes[0]?.revision, 8); await closing; assert.equal(h.owner.snapshot().batch, null);
});

test('preset menus retain scalar bodies only; selected reads bind exact menu revision for apply, rename and delete', async () => {
	const h = host(); await h.owner.listPresets('catalog'); await h.owner.savePreset(source(), all, 'Evening');
	assert.equal(h.owner.snapshot().presets?.presets[0]?.scope, 'full'); assert.equal('settings' in h.owner.snapshot().presets!.presets[0]!, false);
	await h.owner.applyPreset(source(), 'look', 1, 'Preset'); assert.equal(h.bodyReads, 1); assert.equal(h.batches.length, 1);
	await h.owner.renamePreset('catalog', 'look', 1, 'Morning'); assert.equal(h.bodyReads, 2); assert.equal(h.bodies.get('look')?.identity.name, 'Morning');
	await h.owner.deletePreset('catalog', 'look', 2); assert.equal(h.owner.snapshot().presets?.presets.length, 0); await h.owner.close();
});

test('stale selected preset body and foreign identities refuse before photo writes', async () => {
	const h = host(); await h.owner.listPresets('catalog'); await h.owner.savePreset(source(), all, 'Evening');
	const original = h.bodies.get('look')!;
	h.port.presets = { ...h.port.presets!, read: async () => ({ schemaVersion: 1, catalogId: 'catalog', revision: 2, preset: original }) };
	await h.owner.applyPreset(source(), 'look', 1, 'Preset'); assert.equal(h.batches.length, 0);
	assert.ok(h.owner.snapshot().error); await h.owner.close();
});

test('known partial batch ACK survives late cancel and refresh failure without losing target statuses or cleanup notice', async () => {
	const h = host(), held = deferred<PhotoLibraryDevelopBatchReceiptV1>(); await h.owner.copy(source(), all);
	h.port.settings = { ...h.port.settings!, applyBatch: () => held.promise };
	const work = h.owner.paste(source(), 'Paste'); await settle(); const cancel = h.owner.cancel();
	held.resolve({ ...receipt({ schemaVersion: 1, catalogId: 'catalog', targets: [{ photoId: 'photo', versionId: 'master', expectedRevision: 7 }], action: { kind: 'paste', settings: h.owner.snapshot().clipboard! }, label: 'Paste', createdAt: '2026-10-09T00:00:00.000Z' }), completion: 'cancelled', notices: ['cleanup-failed'] });
	const ack = await work; await cancel; assert.equal(ack?.outcomes[0]?.status, 'applied'); assert.equal(h.owner.snapshot().notice, 'refresh-failed');
	assert.deepEqual(h.owner.snapshot().batch?.notices, ['cleanup-failed']); await h.owner.close();
});

test('preset write ACK remains returned after held Close; no selected recipe leaks into the retired menu', async () => {
	const h = host(), held = deferred<Awaited<ReturnType<NonNullable<PhotoLibraryDevelopPortV1['presets']>['write']>>>();
	await h.owner.listPresets('catalog'); h.port.presets = { ...h.port.presets!, write: () => held.promise };
	const saved = h.owner.savePreset(source(), all, 'Evening'); await settle(); const closing = h.owner.close();
	held.resolve({ snapshot: { schemaVersion: 1, catalogId: 'catalog', revision: 1, presets: [{ id: 'look', name: 'Evening', scope: 'full', authoredStateSha256: 'a'.repeat(64) }] }, notices: ['cleanup-failed'] });
	assert.equal((await saved)?.snapshot.revision, 1); await closing; assert.equal(h.owner.snapshot().presetReceipt, null);
});

test('held preset body read joins cancellation and never admits the batch', async () => {
	const h = host(), held = deferred<PhotoLibraryDevelopPresetBodyV1>(); await h.owner.listPresets('catalog'); await h.owner.savePreset(source(), all, 'Evening');
	h.port.presets = { ...h.port.presets!, read: () => held.promise };
	const applying = h.owner.applyPreset(source(), 'look', 1, 'Preset'); await settle(); let joined = false;
	const cancel = h.owner.cancel().then(() => { joined = true; }); await settle(); assert.equal(joined, false);
	held.resolve({ schemaVersion: 1, catalogId: 'catalog', revision: 1, preset: h.bodies.get('look')! }); await Promise.all([applying, cancel]);
	assert.equal(h.batches.length, 0); await h.owner.close();
});

test('the scalar target plan detaches before held reads and survives mixed per-photo outcomes without rereading bodies', async () => {
	const h = host(), held = deferred<PhotoLibraryDevelopSnapshotV1>(), selected = ['other', 'third'];
	h.port.read = request => request.photoId === 'other' ? held.promise : Promise.resolve({ schemaVersion: 1, photoId: request.photoId,
		revision: 13, versionId: 'master', activeVersionId: 'master', develop: defaultImageDevelopStateV1(), versions: [], history: { cursor: 0, entries: [] }, snapshots: [] });
	h.port.settings = { ...h.port.settings!, applyBatch: async request => {
		h.batches.push(request); const before = receipt(request);
		return { ...before, completion: 'interrupted', outcomes: [before.outcomes[0]!, { ...before.outcomes[1]!, status: 'conflict', revision: null, historyCursor: null, code: 'revision-conflict' }], notices: ['cleanup-failed'] };
	} };
	const work = h.owner.sync(source(), selected, all, 'Sync'); selected[1] = 'foreign';
	held.resolve({ schemaVersion: 1, photoId: 'other', revision: 12, versionId: 'alternate', activeVersionId: 'alternate',
		develop: defaultImageDevelopStateV1(), versions: [], history: { cursor: 0, entries: [] }, snapshots: [] });
	const ack = await work; assert.deepEqual(h.batches[0]?.targets.map(target => [target.photoId, target.versionId, target.expectedRevision]), [['other', 'alternate', 12], ['third', 'master', 13]]);
	assert.deepEqual(ack?.outcomes.map(outcome => outcome.status), ['applied', 'conflict']); assert.deepEqual(h.owner.snapshot().batch, ack); await h.owner.close();
});

test('a host cleanup error after a known batch ACK cannot erase returned receipt and retirement suppresses old publication', async () => {
	const h = host(), owner = new PhotoLibraryDevelopSettingsWorkflowV1({ execute: async (run, signal) => {
		await run({ signal: signal!, acquire: async () => h.port, isCurrent: () => true, refresh: async () => undefined }); throw new Error('Host cleanup failed');
	} });
	await owner.copy(source(), all); const ack = await owner.paste(source(), 'Paste'); assert.equal(ack?.outcomes[0]?.status, 'applied');
	assert.equal(owner.snapshot().batch, ack); assert.ok(owner.snapshot().error); await Promise.all([owner.close(), h.owner.close()]);
});

test('oversized or duplicate selection and noncanonical revision refuse before lazy host acquisition', async () => {
	const h = host(); await h.owner.relative('catalog', Array.from({ length: 65 }, (_, index) => `p${index}`), 'tone-ladder-v1', { exposure: 1 }, 'Quick');
	await h.owner.sync(source(), ['same', 'same'], all, 'Sync'); await h.owner.copy({ ...source(), revision: -0 }, all);
	assert.equal(h.acquired, 0); assert.equal(h.batches.length, 0); await h.owner.close();
});
