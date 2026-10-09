/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after } from 'node:test';
import fc from 'fast-check';
import { createVideoEffectV2 } from '../src/common/editor/video-effects-v2.ts';
import type { VideoEffectLeafV2 } from '../src/common/editor/video-effect-leaf-v2.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import type { PhotoLibraryDevelopSettingsV2, PhotoLibraryDevelopPortV2 } from '../src/common/editor/photo-library-develop-port-v2.ts';
import type { PhotoLibraryDevelopSelectionV2, PhotoLibraryDevelopSettingsPacketV2 } from '../src/common/editor/photo-library-develop-settings-port-v2.ts';
import { copyImageDevelopSettingsV2, mergeImageDevelopSettingsV2 } from '../src/common/editor/imaging/image-develop-settings-v2.ts';
import { createImageDevelopPresetV2, applyImageDevelopPresetV2, parseImageDevelopPresetV2, serializeImageDevelopPresetV2 } from '../src/common/editor/imaging/image-develop-preset-v2.ts';
import { createPhotoDevelopWorkspaceV2, commitPhotoDevelopWorkspaceV2, selectPhotoDevelopHistoryV2,
	savePhotoDevelopSnapshotV2, restorePhotoDevelopSnapshotV2, parsePhotoDevelopWorkspaceV1OrV2,
	serializePhotoDevelopWorkspaceV1OrV2 } from '../src/lightscaper/catalog/photo-develop-workspace-v2.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { exportPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-export-v5.ts';
import { importPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-import-v5.ts';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import { createPhotoLibraryRestoreRuntimeV2 } from '../src/lightscaper/photo-library-restore-runtime-v2.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { lutArchiveFixture, LUT_BODY, LUT_REFERENCE } from './helpers/lightscaper-lut-archive-fixture.ts';
import { MemoryLockManager } from './helpers/offline-browser-runtime-store-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const CLOCK = '2026-10-09T12:00:00.000Z';
const ALL = { effectTypes: 'all', geometry: true, localAdjustments: true } as const;
const TYPES = ['white-balance-v1', 'tone-ladder-v1', 'develop-geometry-v1', 'chroma-v1', 'black-white-mix-v1', 'hsl-mixer-v1',
	'point-curves-v1', 'parametric-curves-v1', 'color-wheels-v1', 'detail-sharpen-v1', 'post-crop-vignette-v1', 'clarity-v1',
	'noise-reduction-v1', 'grain-v1', 'texture-v1', 'dehaze-v1', 'cube-lut-profile-v1'] as const;
interface RecipeSpec {
	readonly effects: readonly Readonly<{ type: typeof TYPES[number]; enabled: boolean; value: number; neutral: boolean }>[];
	readonly rotation: number; readonly flip: boolean; readonly local: boolean; readonly explicitProcess2: boolean;
}
const recipes = fc.record({
	effects: fc.array(fc.record({ type: fc.constantFrom(...TYPES), enabled: fc.boolean(), value: fc.integer({ min: -80, max: 80 }),
		neutral: fc.boolean() }), { minLength: 1, maxLength: 12 }),
	rotation: fc.integer({ min: -90, max: 90 }), flip: fc.boolean(), local: fc.boolean(), explicitProcess2: fc.boolean(),
});
const selections = fc.oneof(fc.constant(ALL), fc.record({ effectTypes: fc.uniqueArray(fc.constantFrom(...TYPES)),
	geometry: fc.boolean(), localAdjustments: fc.boolean() }));

function recipe(spec: RecipeSpec): PhotoLibraryDevelopSettingsV2 {
	const effects = spec.effects.map((item, index) => {
		// Generate JSON-canonical scalar controls; negating zero would invent a distinct JS-only value.
		const opposite = item.value === 0 ? 0 : -item.value;
		const params = item.type === 'cube-lut-profile-v1' ? { lut: item.neutral ? null : LUT_REFERENCE }
			: item.type === 'white-balance-v1' ? { temperature: item.value, tint: opposite }
				: item.type === 'tone-ladder-v1' ? { exposure: item.value / 16 }
					: item.type === 'chroma-v1' ? { saturation: item.value, vibrance: opposite } : {};
		return createVideoEffectV2(item.type, { id: `effect-${String(index)}`, enabled: item.enabled, params });
	});
	return normalizeImageDevelopStateV1OrV2({ ...defaultImageDevelopStateV1(),
		processVersion: spec.explicitProcess2 || effects.some(effect => effect.type === 'cube-lut-profile-v1') ? 2 : 1, effects,
		geometry: { crop: null, rotationDegrees: spec.rotation, flipHorizontal: spec.flip, flipVertical: false },
		masks: spec.local ? [{ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], outputNodeId: 'shape',
			nodes: [{ id: 'shape', kind: 'vector-shape', shape: 'rectangle', x: (spec.rotation + 90) / 360, y: 0, width: 0.5, height: 1 }] }] : [],
		maskBindings: spec.local ? [{ effectId: 'effect-0', maskId: 'mask' }] : [] });
}
const effectValue = (effect: VideoEffectLeafV2) => ({ type: effect.type, enabled: effect.enabled, params: effect.params });
function selected(state: PhotoLibraryDevelopSettingsV2, selection: PhotoLibraryDevelopSelectionV2, effect: VideoEffectLeafV2) {
	return (selection.effectTypes === 'all' || selection.effectTypes.includes(effect.type))
		&& (selection.localAdjustments || !state.maskBindings.some(binding => binding.effectId === effect.id));
}
function assertCopy(donor: PhotoLibraryDevelopSettingsV2, selection: PhotoLibraryDevelopSelectionV2, packet: PhotoLibraryDevelopSettingsPacketV2) {
	const effects = donor.effects.filter(effect => selected(donor, selection, effect)), ids = new Set(effects.map(effect => effect.id));
	const bindings = selection.localAdjustments ? donor.maskBindings.filter(binding => ids.has(binding.effectId)) : [];
	const masks = selection.localAdjustments ? donor.masks.filter(mask => bindings.some(binding => binding.maskId === mask.id)
		|| !donor.maskBindings.some(binding => binding.maskId === mask.id)) : [];
	assert.deepEqual(packet.develop.effects, effects); assert.deepEqual(packet.develop.maskBindings, bindings);
	assert.deepEqual(packet.develop.masks, masks); assert.equal(packet.develop.processVersion, donor.processVersion);
	assert.deepEqual(packet.develop.geometry, selection.geometry ? donor.geometry : defaultImageDevelopStateV1().geometry);
}
/** Independent invariants include the donated group's global insertion position and each mask's original body. */
function assertPaste(target: PhotoLibraryDevelopSettingsV2, packet: PhotoLibraryDevelopSettingsPacketV2, result: PhotoLibraryDevelopSettingsV2) {
	const kept = target.effects.filter(effect => !selected(target, packet.selection, effect));
	assert.deepEqual(result.effects.filter(effect => kept.some(original => original.id === effect.id)), kept);
	const first = target.effects.findIndex(effect => selected(target, packet.selection, effect));
	const insertion = first < 0 ? kept.length : first;
	const expected = [...kept.slice(0, insertion), ...packet.develop.effects, ...kept.slice(insertion)];
	assert.deepEqual(result.effects.map(effectValue), expected.map(effectValue));
	assert.equal(result.effects.length, kept.length + packet.develop.effects.length);
	assert.deepEqual(result.geometry, packet.selection.geometry ? packet.develop.geometry : target.geometry);
	assert.equal(result.processVersion, target.processVersion === 2 || result.effects.some(effect => effect.type === 'cube-lut-profile-v1') ? 2 : 1);
	assert.equal(new Set(result.effects.map(effect => effect.id)).size, result.effects.length);
	assert.equal(new Set(result.masks.map(mask => mask.id)).size, result.masks.length);
	for (const binding of result.maskBindings) {
		assert.ok(result.effects.some(effect => effect.id === binding.effectId));
		assert.ok(result.masks.some(mask => mask.id === binding.maskId));
	}
	for (const mask of target.masks) {
		const bindings = target.maskBindings.filter(binding => binding.maskId === mask.id);
		if (!bindings.length || bindings.some(binding => kept.some(effect => effect.id === binding.effectId))) {
			assert.deepEqual(result.masks.find(candidate => candidate.id === mask.id), mask);
		}
	}
	for (const binding of packet.develop.maskBindings) {
		const sourceIndex = packet.develop.effects.findIndex(effect => effect.id === binding.effectId);
		const deliveredEffect = result.effects[insertion + sourceIndex]!;
		const deliveredBinding = result.maskBindings.find(candidate => candidate.effectId === deliveredEffect.id); assert.ok(deliveredBinding);
		const sourceMask = packet.develop.masks.find(mask => mask.id === binding.maskId); assert.ok(sourceMask);
		const deliveredMask = result.masks.find(mask => mask.id === deliveredBinding.maskId); assert.ok(deliveredMask);
		assert.deepEqual({ ...deliveredMask, id: sourceMask.id }, sourceMask);
	}
}

test('seeded mixed history preserves explicit processes, redo custody and immutable snapshots through branches and reopening', () => {
	fc.assert(fc.property(fc.array(recipes, { minLength: 2, maxLength: 8 }), recipes, fc.nat(), (edits, branch, offset) => {
		let workspace = createPhotoDevelopWorkspaceV2(defaultImageDevelopStateV1(), { label: 'Original', createdAt: CLOCK });
		for (const [index, spec] of edits.entries()) {
			const next = recipe(spec), old = serializePhotoDevelopWorkspaceV1OrV2(workspace);
			const previousWorkspace = workspace;
			workspace = commitPhotoDevelopWorkspaceV2(workspace, next, { label: `Edit ${String(index)}`, createdAt: CLOCK });
			assert.equal(serializePhotoDevelopWorkspaceV1OrV2(previousWorkspace), old);
			assert.deepEqual(workspace.entries[workspace.cursor]?.develop, next);
		}
		const captured = workspace.entries[workspace.cursor]!.develop;
		workspace = savePhotoDevelopSnapshotV2(workspace, { id: 'captured', name: 'Captured', createdAt: CLOCK });
		const beforeSelection = workspace.entries, cursor = offset % workspace.entries.length;
		workspace = selectPhotoDevelopHistoryV2(workspace, cursor);
		assert.deepEqual(workspace.entries, beforeSelection);
		const reopened = parsePhotoDevelopWorkspaceV1OrV2(serializePhotoDevelopWorkspaceV1OrV2(workspace));
		assert.deepEqual(reopened.entries, beforeSelection); assert.equal(reopened.cursor, cursor);
		const branchSettings = recipe(branch);
		workspace = commitPhotoDevelopWorkspaceV2(workspace, branchSettings, { label: 'Branch', createdAt: CLOCK });
		if (JSON.stringify(beforeSelection[cursor]?.develop) === JSON.stringify(branchSettings)) assert.deepEqual(workspace.entries, beforeSelection);
		else {
			assert.deepEqual(workspace.entries.slice(0, -1), beforeSelection.slice(0, cursor + 1));
			assert.equal(workspace.entries.length, cursor + 2); assert.equal(workspace.cursor, cursor + 1);
			assert.deepEqual(workspace.entries[workspace.cursor]?.develop, branchSettings);
		}
		assert.deepEqual(workspace.snapshots[0]?.develop, captured);
		const restored = restorePhotoDevelopSnapshotV2(workspace, { snapshotId: 'captured', label: 'Restore', createdAt: CLOCK });
		assert.deepEqual(restored.entries[restored.cursor]?.develop, captured);
		assert.deepEqual(parsePhotoDevelopWorkspaceV1OrV2(serializePhotoDevelopWorkspaceV1OrV2(restored)), restored);
	}), { seed: 20261009, numRuns: 60 });
});

test('seeded full and partial current presets preserve order, local ID custody and repeatable application after serialization', () => {
	fc.assert(fc.property(recipes, recipes, selections, (donorSpec, targetSpec, selection) => {
		const donor = recipe(donorSpec), target = recipe(targetSpec), originals = JSON.stringify([donor, target]);
		const packet = copyImageDevelopSettingsV2({ schemaVersion: 2, develop: donor, selection });
		assertCopy(donor, selection, packet);
		const preset = createImageDevelopPresetV2({ schemaVersion: 2, id: 'generated', name: 'Generated 界', settings: packet });
		assert.equal(preset.identity.authoredStateSha256, createHash('sha256').update(JSON.stringify(packet)).digest('hex'));
		const bytes = serializeImageDevelopPresetV2(preset), reopened = parseImageDevelopPresetV2(bytes);
		assert.equal(serializeImageDevelopPresetV2(reopened), bytes);
		const applied = applyImageDevelopPresetV2({ schemaVersion: 2, target, preset: reopened });
		assertPaste(target, packet, applied);
		assert.deepEqual(mergeImageDevelopSettingsV2({ schemaVersion: 2, target, settings: packet }), applied);
		assert.deepEqual(applyImageDevelopPresetV2({ schemaVersion: 2, target: applied, preset: reopened }), applied);
		assert.equal(JSON.stringify([donor, target]), originals);
	}), { seed: 20261010, numRuns: 100 });
});

test('literal neutral process goldens survive current history and preset dispatch without inferred upgrades', () => {
	const geometry = '"geometry":{"crop":null,"rotationDegrees":0,"flipHorizontal":false,"flipVertical":false}';
	const goldens = [
		`{"processVersion":1,"effects":[],${geometry},"masks":[],"maskBindings":[]}`,
		`{"processVersion":2,"effects":[{"id":"neutral","type":"cube-lut-profile-v1","enabled":false,"params":{"lut":null}}],${geometry},"masks":[],"maskBindings":[]}`,
	];
	for (const golden of goldens) {
		const state = normalizeImageDevelopStateV1OrV2(JSON.parse(golden) as unknown);
		assert.equal(JSON.stringify(state), golden);
		const workspace = createPhotoDevelopWorkspaceV2(state, { label: 'Golden', createdAt: CLOCK });
		assert.equal(JSON.stringify(parsePhotoDevelopWorkspaceV1OrV2(serializePhotoDevelopWorkspaceV1OrV2(workspace)).entries[0]?.develop), golden);
		const settings = copyImageDevelopSettingsV2({ schemaVersion: 2, develop: state, selection: ALL });
		const preset = createImageDevelopPresetV2({ schemaVersion: 2, id: 'golden', name: 'Golden', settings });
		assert.equal(JSON.stringify(parseImageDevelopPresetV2(serializeImageDevelopPresetV2(preset)).settings.develop), golden);
	}
});

async function instrumentedLibrary() {
	const native = mediaRestoreFixture(), fixture = lutArchiveFixture(), second = photoArchiveFixture(2);
	const root = normalizePhotoCatalogRootV1({ ...fixture.root, photoCount: 2 }), records = [fixture.record, second];
	const archive = await exportPhotoCatalogArchiveV5(root, records, [], null, [], fixture.row,
		{ async withBytes(_reference, consume) { return consume(LUT_BODY); } }); assert.ok(archive.blob);
	const options = { name: 'Generated current library', indexedDB: native.factory, locks: new MemoryLockManager() as unknown as LockManager };
	const restore = createPhotoLibraryRestoreRuntimeV2(options);
	try { await restore.restoreArchive(archive.blob); } finally { await restore.close(); }
	return { records, options, open: () => createPhotoLibrarySessionV3(options) };
}
async function record(port: PhotoLibraryDevelopPortV2, photoId: string, develop: PhotoLibraryDevelopSettingsV2) {
	const before = await port.read({ schemaVersion: 2, photoId });
	const ack = await port.apply({ schemaVersion: 2, photoId, expectedRevision: before.revision,
		command: { type: 'record-develop', versionId: before.versionId, develop, label: 'Generated edit', createdAt: CLOCK } });
	assert.deepEqual(ack.notices, []); assert.deepEqual(ack.snapshot.develop, develop); return ack.snapshot;
}

test('seeded production runtime3 and Session2 sync and presets persist through instrumented durable reopen with original digests', async () => {
	const f = await instrumentedLibrary(); let session = await f.open(), iteration = 0;
	try {
		await fc.assert(fc.asyncProperty(recipes, recipes, selections, async (donorSpec, targetSpec, selection) => {
			const source = await record(session.develop, 'photo-1', recipe(donorSpec));
			const target = await record(session.develop, 'photo-2', recipe(targetSpec));
			const settings = session.develop.settings, presets = session.develop.presets; assert.ok(settings); assert.ok(presets);
			const packet = settings.copy({ schemaVersion: 2, develop: source.develop, selection });
			assertCopy(source.develop, selection, packet);
			const batch = { schemaVersion: 2 as const, catalogId: source.catalogId,
				targets: [{ photoId: target.photoId, versionId: target.versionId, expectedRevision: target.revision }],
				action: { kind: 'paste' as const, settings: packet }, label: 'Generated sync', createdAt: CLOCK };
			const receipt = await settings.applyBatch(batch);
			assert.equal(receipt.completion, 'finished'); assert.deepEqual(receipt.notices, []);
			assert.ok(['applied', 'unchanged'].includes(receipt.outcomes[0]!.status));
			const applied = await session.develop.read({ schemaVersion: 2, photoId: target.photoId });
			assertPaste(target.develop, packet, applied.develop);
			const repeated = await settings.applyBatch({ ...batch, targets: [{ ...batch.targets[0]!, expectedRevision: applied.revision }] });
			assert.equal(repeated.outcomes[0]?.status, 'unchanged'); assert.equal(repeated.outcomes[0]?.revision, applied.revision);
			assert.equal(repeated.outcomes[0]?.historyCursor, applied.history.cursor);
			const menu = await presets.list({ schemaVersion: 2, catalogId: source.catalogId });
			const preset = presets.create({ schemaVersion: 2, id: 'generated', name: 'Generated', settings: packet });
			const saved = await presets.write({ schemaVersion: 2, catalogId: source.catalogId,
				command: { type: 'save', expectedRevision: menu.revision, preset } }); assert.deepEqual(saved.notices, []);
			const snapshotId = `snapshot-${String(++iteration)}`;
			const captured = await session.develop.apply({ schemaVersion: 2, photoId: source.photoId, expectedRevision: source.revision,
				command: { type: 'save-develop-snapshot', versionId: source.versionId, id: snapshotId, name: 'Generated', createdAt: CLOCK } });
			await session.close(); session = await f.open();
			assert.deepEqual(await session.develop.read({ schemaVersion: 2, photoId: target.photoId }), applied);
			const reopened = await session.develop.read({ schemaVersion: 2, photoId: source.photoId });
			assert.deepEqual(reopened, captured.snapshot);
			const body = await session.develop.presets!.read({ schemaVersion: 2, catalogId: source.catalogId,
				presetId: 'generated', expectedRevision: saved.snapshot.revision }); assert.deepEqual(body.preset, preset);
		}), { seed: 20261011, numRuns: 18, endOnFailure: true });
		const backedUp = await session.backupCatalog(); assert.ok(backedUp.blob);
		let published = 0, deliveredLuts = 0, deliveredPresets = 0; const seen = new Set<string>();
		await importPhotoCatalogArchiveV5(backedUp.blob, async () => ({
			async writePhoto(photo, original) {
				const expected = f.records.find(record => record.photo.id === photo.id); assert.ok(expected); seen.add(photo.id);
				assert.deepEqual(photo.original, expected.photo.original); assert.deepEqual(photo.extractedMetadata, expected.photo.extractedMetadata);
				const hash = createHash('sha256'); for await (const bytes of original) hash.update(bytes);
				assert.equal(hash.digest('hex'), expected.photo.original.contentSha256);
			},
			async writeDevelopPresets(row) { deliveredPresets++; assert.ok(row.presets.some(preset => preset.identity.id === 'generated')); },
			async writeLut(reference, bytes) {
				deliveredLuts++;
				assert.deepEqual(reference, LUT_REFERENCE); assert.deepEqual(bytes, LUT_BODY);
			}, async writeStack() { assert.fail('Unexpected stack.'); }, async writeSavedCollection() { assert.fail('Unexpected collection.'); },
			async publish() { published++; }, async rollback() { assert.fail('Unexpected rollback.'); },
		}));
		assert.equal(published, 1); assert.equal(deliveredLuts, 1); assert.equal(deliveredPresets, 1);
		assert.deepEqual([...seen].sort(), ['photo-1', 'photo-2']);
	} finally { await session.close(); }
});
