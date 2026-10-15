/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryDevelopSettingsWorkflowCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-settings-workflow-current-v1.ts';
import { PhotoLibraryDevelopSettingsWorkflowV2 } from '../src/common/editor/controller/shared/photo-library-develop-settings-workflow-v2.ts';
import type { ExecutePhotoDevelopCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-current-v1.ts';
import type { PhotoLibraryDevelopPortCurrentV1 } from '../src/common/editor/photo-library-develop-port-current-v1.ts';
import type { PhotoLibraryDevelopCopySelectedCurrentV1, PhotoLibraryDevelopBatchRequestCurrentV1,
	PhotoLibraryDevelopSettingsPortCurrentV1 } from '../src/common/editor/photo-library-develop-settings-port-current-v1.ts';
import type { PhotoLibraryDevelopPresetsPortCurrentV1, PhotoLibraryDevelopPresetCurrentV1,
	PhotoLibraryDevelopPresetSnapshotCurrentV1 } from '../src/common/editor/photo-library-develop-presets-port-current-v1.ts';
import type { ImageDevelopSettingsPacketV4 } from '../src/common/editor/imaging/image-develop-settings-contract-v4.ts';
import type { ImageDevelopSettingsPacketV3 } from '../src/common/editor/imaging/image-develop-settings-contract-v3.ts';
import { copyImageDevelopSettingsV4, mergeImageDevelopSettingsV4, adjustImageDevelopSettingsV4 } from '../src/common/editor/imaging/image-develop-settings-v4.ts';
import { createImageDevelopSelectedPresetV4 } from '../src/common/editor/imaging/image-develop-preset-selected-v4.ts';
import { createImageDevelopSelectedPresetV3 } from '../src/common/editor/imaging/image-develop-preset-selected-v3.ts';
import { parseImageDevelopPresetV4, serializeImageDevelopPresetV4 } from '../src/common/editor/imaging/image-develop-preset-v4.ts';
import { normalizeImageDevelopStateV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createVideoEffectV2 } from '../src/common/editor/video-effects-v2.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const TIME = '2026-10-20T00:00:00.000Z';
const SELECTION = Object.freeze({ effectTypes: 'all' as const, geometry: true, localAdjustments: true, repairs: true, rawDevelopment: true });
type PresetRequest<Settings> = Readonly<{ schemaVersion: 3; id: string; name: string; settings: Settings }>;
function source() {
	return { schemaVersion: 3 as const, catalogId: 'catalog-1', photoId: 'photo-1', versionId: 'version-1', revision: 7,
		develop: normalizeImageDevelopStateV4({ ...defaultImageDevelopStateV2(), processVersion: 4,
			rawDevelopment: { schemaVersion: 1, mode: 'recovery' },
			effects: [createVideoEffectV2('tone-ladder-v1', { id: 'tone', params: { exposure: .5 } })],
			repairs: { schemaVersion: 1, spots: [{ id: 'clone', mode: 'clone', enabled: false, target: { x: .5, y: .5 },
				source: { x: .25, y: .5 }, radius: .1, feather: .5, opacity: 1 }] } }) };
}

// These are explicit scalar Session seams, using the actual V4 metadata owners.
// Native catalog publication, enrolled brush proof and RAW decoding have their
// own owning tests; no fake resource or Original authority is provided here.
function fixture() {
	const copies: PhotoLibraryDevelopCopySelectedCurrentV1[] = [], batches: PhotoLibraryDevelopBatchRequestCurrentV1[] = [];
	const packets: ImageDevelopSettingsPacketV4[] = [], saved = new Map<string, PhotoLibraryDevelopPresetCurrentV1>();
	const hooks: { acquire?: () => Promise<void>; copy?: (options?: Readonly<{ signal?: AbortSignal }>) => Promise<void>;
		refresh?: () => Promise<void>; current?: () => boolean } = {};
	let presetRevision = 0, acquisitions = 0, refreshes = 0;
	function menu(): PhotoLibraryDevelopPresetSnapshotCurrentV1 {
		return { schemaVersion: 3, catalogId: 'catalog-1', revision: presetRevision,
			presets: [...saved.values()].map(preset => ({ id: preset.identity.id, name: preset.identity.name,
				authoredStateSha256: preset.identity.authoredStateSha256, scope: 'full' as const })) };
	}
	const settings: PhotoLibraryDevelopSettingsPortCurrentV1 = {
		copy(request) { assert.equal(this, settings); return copyImageDevelopSettingsV4({ ...request, schemaVersion: 4 }); },
		async copySelected(request, options) {
			assert.equal(this, settings); assert.equal(request.schemaVersion, 3); copies.push(request);
			await hooks.copy?.(options);
			const packet = copyImageDevelopSettingsV4({ schemaVersion: 4, develop: request.develop, selection: request.selection });
			packets.push(packet); return packet;
		},
		merge(request) { return mergeImageDevelopSettingsV4({ ...request, schemaVersion: 4 }); },
		adjust(request) { return adjustImageDevelopSettingsV4({ ...request, schemaVersion: 4 }); },
		async applyBatch(request) {
			assert.equal(this, settings); assert.equal(request.schemaVersion, 3); batches.push(request);
			if (request.action.kind === 'paste') assert.ok(packets.includes(request.action.settings as ImageDevelopSettingsPacketV4), 'Paste retains the enrolled selected packet object.');
			return { schemaVersion: 3, catalogId: request.catalogId, completion: 'finished', notices: [], outcomes: request.targets.map((target, index) => ({
				...target, index, status: 'applied', revision: target.expectedRevision + 1, historyCursor: 1, code: null })) };
		},
	};
	function createPreset(this: PhotoLibraryDevelopPresetsPortCurrentV1, request: PresetRequest<ImageDevelopSettingsPacketV3>): ReturnType<typeof createImageDevelopSelectedPresetV3>;
	function createPreset(this: PhotoLibraryDevelopPresetsPortCurrentV1, request: PresetRequest<ImageDevelopSettingsPacketV4>): ReturnType<typeof createImageDevelopSelectedPresetV4>;
	function createPreset(this: PhotoLibraryDevelopPresetsPortCurrentV1, request: PresetRequest<ImageDevelopSettingsPacketV3 | ImageDevelopSettingsPacketV4>): ReturnType<typeof createImageDevelopSelectedPresetV3> | ReturnType<typeof createImageDevelopSelectedPresetV4>;
	function createPreset(this: PhotoLibraryDevelopPresetsPortCurrentV1, request: PresetRequest<ImageDevelopSettingsPacketV3 | ImageDevelopSettingsPacketV4>) {
		assert.equal(this, presets); assert.equal(request.schemaVersion, 3);
		const settings = request.settings;
		if (settings.schemaVersion === 3) return createImageDevelopSelectedPresetV3({ ...request, settings });
		assert.ok(packets.includes(settings));
		return createImageDevelopSelectedPresetV4({ ...request, schemaVersion: 4, settings });
	}
	const presets: PhotoLibraryDevelopPresetsPortCurrentV1 = {
		create: createPreset,
		parse: parseImageDevelopPresetV4, serialize: serializeImageDevelopPresetV4,
		async list(request) { assert.equal(this, presets); assert.equal(request.schemaVersion, 3); return menu(); },
		async read(request) {
			assert.equal(this, presets); assert.equal(request.schemaVersion, 3); assert.equal(request.expectedRevision, presetRevision);
			const preset = saved.get(request.presetId); assert.ok(preset); return { schemaVersion: 3, catalogId: request.catalogId, revision: presetRevision, preset };
		},
		async write(request) {
			assert.equal(this, presets); assert.equal(request.schemaVersion, 3); assert.equal(request.command.expectedRevision, presetRevision);
			if (request.command.type === 'save') saved.set(request.command.preset.identity.id, request.command.preset);
			else saved.delete(request.command.presetId);
			presetRevision++; return { schemaVersion: 3, snapshot: menu(), notices: [] };
		},
	};
	const port: PhotoLibraryDevelopPortCurrentV1 = { schemaVersion: 3, settingsCurrent: settings, presetsCurrent: presets,
		read: async () => assert.fail('These operations already have their selected source.'), apply: async () => assert.fail('Settings use the named child writer.') };
	const execute: ExecutePhotoDevelopCurrentV1 = async (action, signal) => {
		await action({ signal: signal ?? new AbortController().signal,
			acquire: async () => { acquisitions++; await hooks.acquire?.(); return port; },
			isCurrent: () => hooks.current?.() ?? true,
			refresh: async () => { refreshes++; await hooks.refresh?.(); } });
	};
	const owner = new PhotoLibraryDevelopSettingsWorkflowCurrentV1({ execute, now: () => TIME, createId: () => 'preset-1' });
	return { owner, hooks, copies, batches, packets, saved, get acquisitions() { return acquisitions; }, get refreshes() { return refreshes; } };
}

test('Current settings capture the RAW draft before Session acquisition and preserve the exact Packet4 through Paste and refresh failure', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(), mutable = structuredClone(source());
	f.hooks.acquire = async () => { entered.resolve(); await release.promise; };
	let copying: Promise<unknown> | undefined;
	try {
		copying = f.owner.copy(mutable, SELECTION); await entered.promise;
		Reflect.set(mutable.develop.rawDevelopment, 'mode', 'canonical'); Reflect.set(mutable.develop.repairs.spots[0]!.source, 'x', 1);
		release.resolve(); await copying;
		assert.equal(f.copies.length, 1); assert.deepEqual(f.copies[0]!.develop, source().develop);
		const packet = f.owner.snapshot().clipboard; assert.ok(packet); assert.equal(packet.schemaVersion, 4); assert.deepEqual(packet.develop, source().develop);
		await f.owner.dismiss(); f.owner.resume(); assert.equal(f.owner.snapshot().clipboard, packet);
		f.hooks.refresh = async () => { throw new Error('Selected UI refresh failed after ACK.'); };
		const receipt = await f.owner.paste(source(), 'Paste recovery'); assert.ok(receipt);
		assert.equal(receipt.schemaVersion, 3); assert.equal(f.owner.snapshot().batch, receipt); assert.equal(f.owner.snapshot().notice, 'refresh-failed');
		const request = f.batches[0]!; assert.equal(request.schemaVersion, 3); assert.equal(request.action.kind, 'paste');
		if (request.action.kind !== 'paste') assert.fail('Expected paste.');
		assert.equal(request.action.settings, packet); assert.equal(f.refreshes, 1);
	} finally { release.resolve(); await copying; await f.owner.close(); }
});

test('Current preset Save, rename and native preset Apply keep a process4 body inside schema3 Session commands', async () => {
	const f = fixture();
	try {
		await f.owner.listPresets('catalog-1');
		const receipt = await f.owner.savePreset(source(), SELECTION, 'Recover sky'); assert.ok(receipt);
		assert.equal(receipt.schemaVersion, 3); assert.equal(receipt.snapshot.revision, 1);
		const initial = f.saved.get('preset-1'); assert.ok(initial); assert.equal(initial.schemaVersion, 4); assert.deepEqual(initial.settings.develop, source().develop);
		const renamed = await f.owner.renamePreset('catalog-1', 'preset-1', 1, 'Recovered daylight'); assert.ok(renamed);
		const after = f.saved.get('preset-1'); assert.ok(after); assert.equal(after.schemaVersion, 4); assert.equal(after.identity.name, 'Recovered daylight');
		assert.deepEqual(after.settings, initial.settings); assert.equal(after.identity.authoredStateSha256, initial.identity.authoredStateSha256);
		await f.owner.applyPreset(source(), 'preset-1', 2, 'Use recovery preset');
		assert.deepEqual(f.batches[0]!.action, { kind: 'preset', presetId: 'preset-1', expectedPresetRevision: 2 });
		assert.equal(f.batches[0]!.schemaVersion, 3);
		const count = f.acquisitions; await f.owner.renamePreset('catalog-1', 'preset-1', 1, 'Stale row');
		assert.equal(f.acquisitions, count, 'The retained stale row cannot reacquire a Session.'); assert.ok(f.owner.snapshot().error);
	} finally { await f.owner.close(); }
});

test('Current settings Close joins a held selected copy and never publishes its retired Packet4', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>();
	let selectedSignal: AbortSignal | undefined, work: Promise<unknown> | undefined, closing: Promise<void> | undefined;
	f.hooks.copy = async options => { selectedSignal = options?.signal; entered.resolve(); await release.promise; };
	try {
		work = f.owner.copy(source(), SELECTION); await entered.promise; closing = f.owner.close();
		assert.equal(f.owner.close(), closing); assert.equal(await remainsPending(closing), true); assert.equal(selectedSignal?.aborted, true);
		assert.equal(f.owner.snapshot().clipboard, null); release.resolve(); await work; await closing;
		assert.equal(f.packets.length, 1); assert.equal(f.owner.snapshot().clipboard, null); assert.equal(f.batches.length, 0);
	} finally { release.resolve(); await work; await closing; await f.owner.close(); }
});

test('A selected source becoming stale during Copy cannot publish a RAW clipboard or write a target', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(); let current = true, work: Promise<unknown> | undefined;
	f.hooks.current = () => current; f.hooks.copy = async () => { entered.resolve(); await release.promise; };
	try {
		work = f.owner.copy(source(), SELECTION); await entered.promise; current = false; release.resolve(); await work;
		assert.equal(f.packets.length, 1); assert.equal(f.owner.snapshot().clipboard, null); assert.equal(f.batches.length, 0);
	} finally { release.resolve(); await work; await f.owner.close(); }
});

test('The permanent V2 settings workflow refuses a RAW process4 source before Session acquisition', async () => {
	let acquisitions = 0;
	const owner = new PhotoLibraryDevelopSettingsWorkflowV2({ execute: async () => { acquisitions++; assert.fail('Legacy cannot acquire for process4.'); } });
	try {
		await (Reflect.apply(owner.copy, owner, [source(), SELECTION]) as Promise<unknown>);
		assert.equal(acquisitions, 0); assert.equal(owner.snapshot().clipboard, null); assert.ok(owner.snapshot().error);
	} finally { await owner.close(); }
});
