/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import fc from 'fast-check';
import type { ImageDevelopStateThroughV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { normalizeImageDevelopStateV3, type ImageDevelopStateV3 } from '../src/common/editor/imaging/image-develop-state-v3.ts';
import type { ImageDevelopSelectionV3, ImageDevelopSettingsPacketV3 } from '../src/common/editor/imaging/image-develop-settings-contract-v3.ts';
import type { ImageDevelopSelectionV4, ImageDevelopSettingsPacketV4 } from '../src/common/editor/imaging/image-develop-settings-contract-v4.ts';
import type { VideoEffectLeafV2 } from '../src/common/editor/video-effect-leaf-v2.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { copyImageDevelopSettingsV3 } from '../src/common/editor/imaging/image-develop-settings-v3.ts';
import { createImageDevelopPresetV3 } from '../src/common/editor/imaging/image-develop-preset-v3.ts';
import { applyImageDevelopPresetCurrentV1, parseImageDevelopPresetCurrentV1, serializeImageDevelopPresetCurrentV1 } from '../src/common/editor/imaging/image-develop-preset-current-v1.ts';
import { normalizePhotoDevelopPresetRowV3 } from '../src/lightscaper/storage/photo-develop-preset-row-v3.ts';
import { normalizePhotoDevelopPresetRowCurrentV1 } from '../src/lightscaper/storage/photo-develop-preset-row-current-v1.ts';
import { encodePhotoDevelopPresetPackV3, readPhotoDevelopPresetPackV3 } from '../src/lightscaper/archive/develop-preset-pack-v3.ts';
import { encodePhotoDevelopPresetPackCurrentV1, readPhotoDevelopPresetPackCurrentV1 } from '../src/lightscaper/archive/develop-preset-pack-current-v1.ts';
import { GENERATED_CURRENT_TIME, generatedDevelopSpecCurrentV1, generatedDevelopCurrentV1,
	developPropertiesFixtureCurrentV1 } from './helpers/lightscaper-develop-properties-current-fixture.ts';

const FULL = Object.freeze({ effectTypes: 'all' as const, geometry: true, localAdjustments: true, repairs: true });
const TYPES = ['white-balance-v1', 'tone-ladder-v1', 'chroma-v1', 'cube-lut-profile-v1'] as const;
const partials: fc.Arbitrary<ImageDevelopSelectionV3> = fc.record({ effectTypes: fc.uniqueArray(fc.constantFrom(...TYPES), { maxLength: TYPES.length }),
	geometry: fc.boolean(), localAdjustments: fc.boolean(), repairs: fc.boolean() });
const selections: fc.Arbitrary<ImageDevelopSelectionV3> = fc.oneof(fc.constant(FULL), partials);
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function repaired(value: Readonly<ImageDevelopStateThroughV4>): asserts value is Readonly<ImageDevelopStateV3> { assert.equal(value.processVersion, 3); }
const semantic = (effect: VideoEffectLeafV2) => ({ type: effect.type, enabled: effect.enabled, params: effect.params });

/** Contract oracle: local adjustments form one complete group independent of
 * the unbound effect-type picker. No allocator, merger or normalizer is used. */
function donated(state: Readonly<ImageDevelopStateThroughV4>, selection: ImageDevelopSelectionV3, effect: VideoEffectLeafV2): boolean {
	return state.maskBindings.some(binding => binding.effectId === effect.id) ? selection.localAdjustments
		: selection.effectTypes === 'all' || selection.effectTypes.includes(effect.type);
}
function assertPacket(source: Readonly<ImageDevelopStateV3>, selection: ImageDevelopSelectionV3 | ImageDevelopSelectionV4, packet: Readonly<ImageDevelopSettingsPacketV3 | ImageDevelopSettingsPacketV4>): void {
	repaired(packet.develop); assert.equal(packet.schemaVersion, Object.hasOwn(selection, 'rawDevelopment') ? 4 : 3);
	assert.deepEqual(packet.selection, { ...selection, effectTypes: selection.effectTypes === 'all' ? 'all' : [...selection.effectTypes].sort() });
	assert.deepEqual(packet.develop.effects, source.effects.filter(effect => donated(source, selection, effect)));
	assert.deepEqual(packet.develop.masks, selection.localAdjustments ? source.masks : []);
	assert.deepEqual(packet.develop.maskBindings, selection.localAdjustments ? source.maskBindings : []);
	assert.deepEqual(packet.develop.geometry, selection.geometry ? source.geometry : defaultImageDevelopStateV1().geometry);
	assert.deepEqual(packet.develop.repairs, selection.repairs ? source.repairs : { schemaVersion: 1, spots: [] });
}
function assertApplied(target: Readonly<ImageDevelopStateV3>, packet: Readonly<ImageDevelopSettingsPacketV3 | ImageDevelopSettingsPacketV4>, result: Readonly<ImageDevelopStateThroughV4>): void {
	repaired(result); repaired(packet.develop);
	const retained = target.effects.filter(effect => !donated(target, packet.selection, effect));
	const first = target.effects.findIndex(effect => donated(target, packet.selection, effect)), insertion = first < 0 ? retained.length : first;
	assert.deepEqual(result.effects.map(semantic), [...retained.slice(0, insertion), ...packet.develop.effects, ...retained.slice(insertion)].map(semantic));
	assert.deepEqual(result.effects.filter(effect => retained.some(original => original.id === effect.id)), retained);
	assert.equal(new Set(result.effects.map(effect => effect.id)).size, result.effects.length);
	assert.equal(new Set(result.masks.map(mask => mask.id)).size, result.masks.length);
	assert.deepEqual(result.masks, packet.selection.localAdjustments ? packet.develop.masks : target.masks);
	assert.deepEqual(result.geometry, packet.selection.geometry ? packet.develop.geometry : target.geometry);
	assert.deepEqual(result.repairs, packet.selection.repairs ? packet.develop.repairs : target.repairs);
	if (!packet.selection.localAdjustments) assert.deepEqual(result.maskBindings, target.maskBindings);
	else {
		assert.equal(result.maskBindings.length, packet.develop.maskBindings.length);
		for (const binding of packet.develop.maskBindings) {
			const index = packet.develop.effects.findIndex(effect => effect.id === binding.effectId);
			const delivered: VideoEffectLeafV2 | undefined = result.effects[insertion + index];
			assert.ok(delivered); assert.deepEqual(result.maskBindings.find(value => value.effectId === delivered.id), { effectId: delivered.id, maskId: binding.maskId });
		}
	}
	for (const binding of result.maskBindings) {
		assert.ok(result.effects.some(effect => effect.id === binding.effectId)); assert.ok(result.masks.some(mask => mask.id === binding.maskId));
	}
}
async function encoded(value: unknown, catalogId: string, current = false): Promise<Uint8Array<ArrayBuffer>> {
	const chunks: Uint8Array[] = []; let length = 0;
	for await (const chunk of (current ? encodePhotoDevelopPresetPackCurrentV1 : encodePhotoDevelopPresetPackV3)(value, catalogId)) { chunks.push(chunk); length += chunk.byteLength; }
	const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
}
async function* fragmented(bytes: Uint8Array<ArrayBuffer>, salt: number) {
	for (let offset = 0; offset < bytes.length;) { const length = 1 + (offset + salt) % 11; yield bytes.slice(offset, offset + length); offset += length; }
}

test('seeded Current3 full and partial preset JSON roundtrips preserve ordered repairs, complete named/composed locals and repeatable application', () => {
	fc.assert(fc.property(generatedDevelopSpecCurrentV1, generatedDevelopSpecCurrentV1, selections, (sourceSpec, targetSpec, selection) => {
		const source = generatedDevelopCurrentV1(sourceSpec), target = generatedDevelopCurrentV1(targetSpec), before = JSON.stringify([source, target]);
		const packet = copyImageDevelopSettingsV3({ schemaVersion: 3, develop: source, selection }); assertPacket(source, selection, packet);
		const preset = createImageDevelopPresetV3({ schemaVersion: 3, id: 'generated-current', name: `Preset ${sourceSpec.name}`, settings: packet });
		assert.equal(preset.identity.authoredStateSha256, sha(packet)); assert.equal(preset.schemaVersion, 3);
		const text = serializeImageDevelopPresetCurrentV1(preset), imported = parseImageDevelopPresetCurrentV1(text);
		assert.deepEqual(imported, preset); assert.equal(serializeImageDevelopPresetCurrentV1(imported), text);
		const applied = applyImageDevelopPresetCurrentV1({ schemaVersion: 3, target, preset: imported }); assertApplied(target, packet, applied);
		assert.deepEqual(applyImageDevelopPresetCurrentV1({ schemaVersion: 3, target: applied, preset: imported }), applied);
		assert.equal(JSON.stringify([source, target]), before);
	}), { seed: 2026101501, numRuns: 80 });
});

test('seeded Current3 preset packs import full and partial recipes through split UTF8 and capture the admitted row before later mutation', async () => {
	await fc.assert(fc.asyncProperty(generatedDevelopSpecCurrentV1, partials, fc.integer({ min: 1, max: 31 }), async (spec, selection, revision) => {
		const source = generatedDevelopCurrentV1(spec);
		const presets = [FULL, selection].map((selected, index) => createImageDevelopPresetV3({ schemaVersion: 3, id: `generated-${String(index)}`, name: `Preset é 空 ${spec.name}`,
			settings: copyImageDevelopSettingsV3({ schemaVersion: 3, develop: source, selection: selected }) }));
		const row = normalizePhotoDevelopPresetRowV3({ schemaVersion: 3, kind: 'photo-develop-presets', catalogId: 'generated-catalog', revision, presets }, 'generated-catalog');
		const bytes = await encoded(row, row.catalogId), imported = await readPhotoDevelopPresetPackV3(fragmented(bytes, revision), row.catalogId);
		assert.deepEqual(imported, row); assert.equal(imported.schemaVersion, 3); assert.deepEqual(await encoded(imported, row.catalogId), bytes);
		const mutable = { ...row, presets: row.presets.map(preset => ({ ...preset, identity: { ...preset.identity } })) };
		const detached = encodePhotoDevelopPresetPackV3(mutable, row.catalogId); mutable.presets[0]!.identity.name = 'Changed after admission';
		assert.deepEqual(await readPhotoDevelopPresetPackV3(detached, row.catalogId), row);
	}), { seed: 2026101502, numRuns: 24, endOnFailure: true });
});

test('seeded local-only repaired presets remap a colliding local effect while preserving the unselected target identity and repeated application', () => {
	fc.assert(fc.property(generatedDevelopSpecCurrentV1, generatedDevelopSpecCurrentV1, (sourceSpec, targetSpec) => {
		const source = generatedDevelopCurrentV1(sourceSpec), target = normalizeImageDevelopStateV3({ ...generatedDevelopCurrentV1(targetSpec), maskBindings: [] });
		const selection = { effectTypes: [] as string[], geometry: false, localAdjustments: true, repairs: false };
		const packet = copyImageDevelopSettingsV3({ schemaVersion: 3, develop: source, selection }), preset = createImageDevelopPresetV3({ schemaVersion: 3, id: 'local-only', name: sourceSpec.name, settings: packet });
		const applied = applyImageDevelopPresetCurrentV1({ schemaVersion: 3, target, preset: parseImageDevelopPresetCurrentV1(serializeImageDevelopPresetCurrentV1(preset)) });
		assertApplied(target, packet, applied);
		assert.equal(applied.effects.length, target.effects.length + 1); assert.deepEqual(applied.effects.find(effect => effect.id === 'local-tone'), target.effects.find(effect => effect.id === 'local-tone'));
		assert.notEqual(applied.maskBindings[0]!.effectId, 'local-tone'); assert.equal(applied.maskBindings[0]!.maskId, 'composed');
		assert.deepEqual(applyImageDevelopPresetCurrentV1({ schemaVersion: 3, target: applied, preset }), applied);
	}), { seed: 2026101505, numRuns: 32 });
});

test('seeded repaired preset JSON refuses future, open and malformed repair metadata even with a recomputed settings digest', () => {
	fc.assert(fc.property(generatedDevelopSpecCurrentV1, fc.constantFrom('future', 'field', 'coordinate', 'duplicate'), (spec, mutation) => {
		const source = generatedDevelopCurrentV1(spec), packet = copyImageDevelopSettingsV3({ schemaVersion: 3, develop: source, selection: FULL });
		const preset = createImageDevelopPresetV3({ schemaVersion: 3, id: 'closed-current', name: spec.name, settings: packet });
		const first = source.repairs.spots[0]!;
		const repairs = { ...source.repairs, spots: mutation === 'duplicate' ? [first, { ...source.repairs.spots[1]!, id: first.id }]
			: [{ ...first, ...(mutation === 'field' ? { pressure: .5 } : mutation === 'coordinate' ? { target: { x: 1.125, y: .5 } } : {}) }, ...source.repairs.spots.slice(1)] };
		const settings = { ...packet, develop: { ...packet.develop, repairs, ...(mutation === 'future' ? { processVersion: 5 } : {}) } };
		const forged = { ...preset, settings, identity: { ...preset.identity, authoredStateSha256: sha(settings) } };
		assert.throws(() => parseImageDevelopPresetCurrentV1(JSON.stringify(forged)));
		assert.deepEqual(parseImageDevelopPresetCurrentV1(serializeImageDevelopPresetCurrentV1(preset)), preset);
	}), { seed: 2026101503, numRuns: 48 });
});

test('seeded actual Current preset rows authenticate genuine retained LUT and brush closures, survive native reopen and apply without changing immutable custody', async () => {
	const f = await developPropertiesFixtureCurrentV1(2);
	try {
		const custody = await f.inspectCustody(); let iteration = 0;
		await fc.assert(fc.asyncProperty(generatedDevelopSpecCurrentV1, generatedDevelopSpecCurrentV1, partials, async (sourceSpec, targetSpec, partial) => {
			const full = iteration++ % 2 === 0;
			const selection: ImageDevelopSelectionV4 = { ...(full ? FULL : partial), rawDevelopment: full };
			const source = generatedDevelopCurrentV1(sourceSpec, f.resourcesForRecipe), target = generatedDevelopCurrentV1(targetSpec, f.resourcesForRecipe);
			await f.record(source, 0); await f.record(target, 1);
			const settings = f.session.develop.settingsCurrent, presets = f.session.develop.presetsCurrent; assert.ok(settings); assert.ok(presets);
			// External JSON may carry a real LUT reference without acquiring body
			// authority. The selected native write below independently verifies it.
			const clean = generatedDevelopCurrentV1(sourceSpec), externalSource = normalizeImageDevelopStateV3({ ...clean,
				effects: [...clean.effects, source.effects.find(effect => effect.type === 'cube-lut-profile-v1')!] });
			const externalPacket = settings.copy({ schemaVersion: 3, develop: externalSource, selection: { ...FULL, rawDevelopment: true } });
			const external = presets.create({ schemaVersion: 3, id: 'external-current', name: `External é ${sourceSpec.name}`, settings: externalPacket });
			const externalText = presets.serialize(external), externalImported = presets.parse(externalText);
			assert.deepEqual(externalImported, external); assert.equal(presets.serialize(externalImported), externalText);
			assertApplied(generatedDevelopCurrentV1(targetSpec), externalPacket, applyImageDevelopPresetCurrentV1({ schemaVersion: 3, target: generatedDevelopCurrentV1(targetSpec), preset: externalImported }));
			const externalMenu = await presets.list({ schemaVersion: 3, catalogId: f.root.id }), beforeExternal = await f.inspect();
			await presets.write({ schemaVersion: 3, catalogId: f.root.id, command: { type: 'save', expectedRevision: externalMenu.revision, preset: externalImported } });
			assert.deepEqual(await f.inspect(), beforeExternal);
			const packet = await settings.copySelected({ ...f.source(0, source), selection }); assertPacket(source, selection, packet);
			const preset = presets.create({ schemaVersion: 3, id: 'generated-current', name: `Native ${sourceSpec.name}`, settings: packet });
			assert.equal(preset.identity.authoredStateSha256, sha(packet));
			const before = await f.inspect(), menu = await presets.list({ schemaVersion: 3, catalogId: f.root.id });
			const saved = await presets.write({ schemaVersion: 3, catalogId: f.root.id, command: { type: 'save', expectedRevision: menu.revision, preset } });
			assert.equal(saved.schemaVersion, 3); assert.deepEqual(saved.notices, []); assert.deepEqual(await f.inspect(), before, 'Preset storage does not edit Photo histories.');
			const stored = await presets.read({ schemaVersion: 3, catalogId: f.root.id, presetId: preset.identity.id, expectedRevision: saved.snapshot.revision });
			assert.deepEqual(stored.preset, preset);
			const row = normalizePhotoDevelopPresetRowCurrentV1(await f.row(), f.root.id), packed = await encoded(row, f.root.id, true);
			assert.equal(row.schemaVersion, 4);
			const imported = await readPhotoDevelopPresetPackCurrentV1(fragmented(packed, iteration), f.root.id); assert.deepEqual(imported, row);
			const importedPreset = imported.presets.find(value => value.identity.id === preset.identity.id); assert.ok(importedPreset);
			const unchanged = await presets.write({ schemaVersion: 3, catalogId: f.root.id, command: { type: 'save', expectedRevision: saved.snapshot.revision, preset: importedPreset } });
			assert.deepEqual(unchanged.snapshot, saved.snapshot, 'An exact imported preset keeps its native row revision.');
			const hasBrush = packet.develop.masks.some(mask => mask.inputs.length > 0);
			if (hasBrush) { assert.throws(() => presets.serialize(preset)); assert.throws(() => presets.parse(JSON.stringify(preset))); }
			else assert.deepEqual(presets.parse(presets.serialize(preset)), preset);
			await f.reopen(); const currentPresets = f.session.develop.presetsCurrent, currentSettings = f.session.develop.settingsCurrent; assert.ok(currentPresets); assert.ok(currentSettings);
			assert.deepEqual(await currentPresets.read({ schemaVersion: 3, catalogId: f.root.id, presetId: preset.identity.id, expectedRevision: saved.snapshot.revision }), stored);
			const prior = await f.read(1); repaired(prior.develop);
			if (hasBrush) assert.throws(() => currentSettings.merge({ schemaVersion: 3, target: prior.develop, settings: stored.preset.settings }), 'Native preset metadata is not a newly issued clipboard packet.');
			const batch = { schemaVersion: 3 as const, catalogId: f.root.id, targets: [{ photoId: prior.photoId, versionId: prior.versionId, expectedRevision: prior.revision }],
				action: { kind: 'preset' as const, presetId: preset.identity.id, expectedPresetRevision: saved.snapshot.revision }, label: 'Generated Current preset', createdAt: GENERATED_CURRENT_TIME };
			const receipt = await currentSettings.applyBatch(batch); assert.equal(receipt.completion, 'finished'); assert.deepEqual(receipt.notices, []);
			assert.ok(['applied', 'unchanged'].includes(receipt.outcomes[0]!.status));
			const applied = await f.read(1); assertApplied(prior.develop, packet, applied.develop);
			const repeated = await currentSettings.applyBatch({ ...batch, targets: [{ ...batch.targets[0]!, expectedRevision: applied.revision }] });
			assert.equal(repeated.outcomes[0]?.status, 'unchanged'); assert.equal(repeated.outcomes[0]?.revision, applied.revision); assert.equal(repeated.outcomes[0]?.historyCursor, applied.history.cursor);
			await f.reopen(); assert.deepEqual(await f.read(1), applied); assert.deepEqual(await f.inspectCustody(), custody);
			assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
		}), { seed: 2026101504, numRuns: 12, endOnFailure: true });
	} finally { await f.close(); }
});
