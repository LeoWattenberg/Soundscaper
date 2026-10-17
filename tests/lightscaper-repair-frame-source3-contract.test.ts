/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { normalizeFramescaperImageSourceV1, FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../src/common/editor/timeline-image-model.ts';
import { normalizeFramescaperImageSourceV2, normalizeFramescaperImageSourceV1OrV2, framescaperImageSourceResourceReferencesV2 } from '../src/common/editor/timeline-image-model-v2.ts';
import { createImageDevelopHandoffProvenanceV1, normalizeImageDevelopHandoffProvenanceV1, imageDevelopHandoffRecipeSha256V1 } from '../src/common/editor/image-develop-handoff-provenance-v1.ts';
import { normalizeFramescaperImageSourceV3, framescaperImageSourceResourceReferencesV3 } from '../src/common/editor/timeline-image-model-v3.ts';
import { normalizeFramescaperImageSourceCurrentV1, framescaperImageSourceResourceReferencesCurrentV1 } from '../src/common/editor/timeline-image-model-current-v1.ts';
import { createImageDevelopHandoffProvenanceV2, normalizeImageDevelopHandoffProvenanceV2, imageDevelopHandoffRecipeSha256V2 } from '../src/common/editor/image-develop-handoff-provenance-v2.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';

// Root qualified the genuine legacy-owner admission RED before these named
// successors became the subjects. Permanent old-owner controls remain below.
const source3 = normalizeFramescaperImageSourceV3;
const sourceCurrent = normalizeFramescaperImageSourceCurrentV1;
const provenance2 = normalizeImageDevelopHandoffProvenanceV2;
const createProvenance2 = createImageDevelopHandoffProvenanceV2;
const recipeHash = imageDevelopHandoffRecipeSha256V2;
const resources3 = framescaperImageSourceResourceReferencesV3;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha = (index: number) => index.toString(16).padStart(64, '0');
const LUT = { storageKey: `lut-sha256:${sha(9)}`, sha256: sha(9), byteLength: 73, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
const brush = (index: number) => ({ storageKey: `brush-mask-v1:2:1:${sha(index)}`, sha256: sha(index), width: 2, height: 1, byteLength: 18 });
const origin = { schemaFamily: 'lightscaper', schemaVersion: 3, catalogId: 'catalog', photoId: 'photo', revision: 7,
	versionId: 'copy', versionKind: 'virtual-copy', versionName: 'Saved repairs', versionCreatedAt: '2026-10-01T00:00:00.000Z' };
const original = { exactName: 'e\u0301.png', sha256: 'a'.repeat(64), byteLength: 17 };
function full() {
	return replaceImageDevelopRepairSpotsV1({ ...defaultImageDevelopStateV2(), effects: [{ id: 'lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut: LUT } }],
		masks: [{ schemaVersion: 2, id: 'paint', name: 'Retained named matte', kind: 'matte',
			inputs: [{ name: 'paint', kind: 'alpha', sourceRef: brush(1).storageKey }, { name: 'unused', kind: 'raster', sourceRef: brush(2).storageKey }],
			nodes: [{ id: 'paint-node', kind: 'alpha', inputName: 'paint' }, { id: 'range', kind: 'luminance-range', lower: 0.1, upper: 0.2, falloff: 0.1 },
				{ id: 'out', kind: 'boolean', operation: 'union', inputNodeIds: ['paint-node', 'range'] }], outputNodeId: 'out' }], maskBindings: [] },
	{ schemaVersion: 1, spots: [{ id: 'clone', mode: 'clone', enabled: false, target: { x: 0.7, y: 0.5 }, source: { x: 0.2, y: 0.5 }, radius: 0.15, feather: 0.5, opacity: 0.75 },
		{ id: 'heal', mode: 'heal', enabled: true, target: { x: 0.7, y: 0.5 }, source: { x: 0.2, y: 0.5 }, radius: 0.15, feather: 0, opacity: 1 }] });
}
function base() {
	return normalizeFramescaperImageSourceV1({ schemaVersion: 1, kind: 'image', id: 'image', name: 'Independent display title', mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
		storageKey: 'image', contentSha256: 'b'.repeat(64), assetByteLength: 2048,
		original: { fileName: 'é.png', mimeType: 'image/png', recognizedFormat: 'png', byteLength: 17, sha256: original.sha256 },
		canonical: { width: 10, height: 5, hasAlpha: true, frameCount: 1, durationTicks: '1000000', timingMode: 'fallback' }, conversionReceiptSha256: 'c'.repeat(64) });
}
function raw(develop: unknown = full()) {
	const state = normalizeImageDevelopStateCurrentV1(develop);
	return { ...base(), schemaVersion: 3, develop: state, developed: { width: 10, height: 5 },
		provenance: { schemaVersion: 2, kind: 'image-develop-handoff', origin, original, developSha256: digest(state) } };
}

test('Source3 retains genuine full Current recipe and immutable pack facts with independently hashed provenance2', () => {
	const value = raw(), admitted = source3(value);
	assert.deepEqual(admitted, value); assert.equal(admitted.schemaVersion, 3); assert.equal(admitted.provenance.schemaVersion, 2);
	assert.deepEqual(admitted.develop, full()); assert.equal(admitted.provenance.developSha256, digest(full()));
	assert.equal(admitted.original.fileName, 'é.png'); assert.equal(admitted.provenance.original.exactName, 'e\u0301.png');
	assert.equal(admitted.contentSha256, base().contentSha256); assert.deepEqual(admitted.canonical, base().canonical);
	assert.ok(Object.isFrozen(admitted)); assert.ok(Object.isFrozen(admitted.develop)); assert.ok(Object.isFrozen(admitted.provenance.origin));
	assert.deepEqual(sourceCurrent(structuredClone(value)), value);
});

test('provenance2 hashes ordered Clone and Heal, names, disabled LUT and unused declarations without computational projection', () => {
	const state = full(), value = createProvenance2({ origin, original, develop: state });
	assert.equal(value.schemaVersion, 2); assert.equal(value.developSha256, digest(state)); assert.equal(recipeHash(state), digest(state));
	assert.deepEqual(provenance2(JSON.parse(JSON.stringify(value)) as unknown), value);
	const changed = [{ ...state, repairs: { schemaVersion: 1, spots: [...state.repairs.spots].reverse() } },
		{ ...state, masks: state.masks.map(mask => ({ ...mask, name: 'Other name' })) },
		{ ...state, masks: state.masks.map(mask => ({ ...mask, inputs: mask.inputs.map(input => input.name === 'unused' ? { ...input, sourceRef: brush(3).storageKey } : input) })) },
		{ ...state, effects: state.effects.map(effect => ({ ...effect, enabled: true })) }];
	for (const develop of changed) { const normalized = normalizeImageDevelopStateCurrentV1(develop); assert.notEqual(recipeHash(normalized), value.developSha256);
		assert.throws(() => source3({ ...raw(), develop: normalized })); }
});

test('explicit Photo3 provenance may bind exact legacy recipes without promoting their process', () => {
	for (const develop of [defaultImageDevelopStateV1(), defaultImageDevelopStateV2(), replaceImageDevelopRepairSpotsV1(defaultImageDevelopStateV1(), { schemaVersion: 1, spots: [] })]) {
		const value = raw(develop), admitted = source3(value); assert.equal(admitted.schemaVersion, 3);
		assert.equal(admitted.develop.processVersion, develop.processVersion); assert.equal(JSON.stringify(admitted.develop), JSON.stringify(develop));
		assert.deepEqual(admitted.provenance.origin, origin); assert.equal(Object.hasOwn(admitted.develop, 'repairs'), develop.processVersion === 3);
	}
	for (const schemaVersion of [1, 2]) assert.throws(() => createProvenance2({ origin: { ...origin, schemaVersion }, original, develop: full() }));
	const saved = full(), develop = normalizeImageDevelopStateCurrentV1({ processVersion: 2, effects: saved.effects, geometry: saved.geometry, masks: saved.masks, maskBindings: saved.maskBindings });
	const truthfulOrigin = { ...origin, schemaVersion: 2 }, provenance = createProvenance2({ origin: truthfulOrigin, original, develop });
	const legacyBrush = source3({ ...raw(develop), provenance });
	assert.equal(legacyBrush.develop.processVersion, 2); assert.deepEqual(legacyBrush.provenance.origin, truthfulOrigin);
	assert.deepEqual(resources3(legacyBrush), { luts: [LUT], brushes: [brush(1), brush(2)] });
});

test('Frame provenance2 retains actual source/project/clip/revision identities beside an edited Current recipe', () => {
	const frame = { schemaFamily: 'framescaper', schemaVersion: 1, projectId: 'project', revision: 8, sourceId: 'image', sequenceId: 'sequence', clipId: 'clip' };
	const provenance = createProvenance2({ origin: frame, original, develop: full() });
	assert.equal(provenance.schemaVersion, 2); assert.deepEqual(provenance.origin, frame);
	assert.deepEqual(source3({ ...raw(), provenance }).provenance, provenance);
	assert.throws(() => createProvenance2({ origin: { ...frame, schemaVersion: 2 }, original, develop: full() }));
});

test('Source3 resource metadata retains disabled LUT and every declared unused brush, without body authority', () => {
	const value = raw(); assert.deepEqual(resources3(value), { luts: [LUT], brushes: [brush(1), brush(2)] });
	const duplicate = normalizeImageDevelopStateCurrentV1({ ...full(), effects: [full().effects[0], { ...full().effects[0], id: 'duplicate' }] });
	assert.deepEqual(resources3(raw(duplicate)), { luts: [LUT], brushes: [brush(1), brush(2)] });
	for (const sourceRef of ['external-unused', `brush-mask-v2:2:1:${sha(2)}`]) {
		const develop = normalizeImageDevelopStateCurrentV1({ ...full(), masks: full().masks.map(mask => ({ ...mask,
			inputs: mask.inputs.map(input => input.name === 'unused' ? { ...input, sourceRef } : input) })) });
		assert.throws(() => source3(raw(develop))); assert.throws(() => resources3(raw(develop)));
	}
	const saved = full(), develop = normalizeImageDevelopStateCurrentV1({ processVersion: 2, effects: saved.effects, geometry: saved.geometry, masks: saved.masks, maskBindings: saved.maskBindings });
	for (const sourceRef of [brush(1).storageKey, 'external-source']) {
		const recipe = normalizeImageDevelopStateCurrentV1({ ...develop, masks: develop.masks.map(mask => ({ ...mask, inputs: mask.inputs.map(input => ({ ...input, sourceRef })) })) });
		const provenance = createImageDevelopHandoffProvenanceV1({ origin: { ...origin, schemaVersion: 2 }, original, develop: recipe });
		const legacy = normalizeFramescaperImageSourceV2({ ...base(), schemaVersion: 2, develop: recipe, developed: { width: 10, height: 5 }, provenance });
		assert.deepEqual(framescaperImageSourceResourceReferencesV2(legacy), [LUT]);
		assert.throws(() => framescaperImageSourceResourceReferencesCurrentV1(legacy), /Source3/u);
	}
});

test('Source3/provenance2 closed admission detaches mutable data and refuses accessors or hidden authority without invoking getters', () => {
	const input = structuredClone(raw()), before = structuredClone(input), admitted = source3(input); let reads = 0;
	if (input.develop.processVersion !== 3) assert.fail('Expected mutable cloned process3 fixture.');
	Reflect.set(input.develop.repairs.spots[0]!.source, 'x', 0.9); assert.deepEqual(admitted, before);
	const accessor = Object.defineProperty({ ...before }, 'develop', { enumerable: true, get() { reads++; return before.develop; } });
	for (const value of [accessor, { ...before, body: new Uint8Array(1) }, { ...before, source: {} }, { ...before, [Symbol('authority')]: true },
		Object.assign(Object.create({ inherited: true }) as object, before), { ...before, schemaVersion: 4 }]) assert.throws(() => source3(value));
	const p = before.provenance, originAccessor = Object.defineProperty({ ...p }, 'origin', { enumerable: true, get() { reads++; return p.origin; } });
	for (const value of [originAccessor, { ...p, bytes: new Uint8Array(1) }, { ...p, schemaVersion: 3 }, { ...p, original: { ...original, sha256: original.sha256.toUpperCase() } }]) assert.throws(() => provenance2(value));
	assert.equal(reads, 0);
});

test('Source3 keeps static single-frame, dimension and original/provenance identity limits', () => {
	const value = raw(); assert.deepEqual(source3(value), value);
	for (const bad of [{ ...value, canonical: { ...value.canonical, frameCount: 2 } }, { ...value, developed: { width: 8193, height: 5 } },
		{ ...value, developed: { width: 8192, height: 8192 } }, { ...value, assetByteLength: 536_870_913 },
		{ ...value, original: { ...value.original, byteLength: 18 } }, { ...value, original: { ...value.original, sha256: 'd'.repeat(64) } },
		{ ...value, original: { ...value.original, fileName: 'display.png' } }, { ...value, provenance: { ...value.provenance, developSha256: 'e'.repeat(64) } }]) assert.throws(() => source3(bad));
});

test('Current source dispatch preserves byte-exact Source1/2 and strict legacy owners permanently refuse Source3/provenance2', () => {
	const first = base(), develop = defaultImageDevelopStateV2(), provenance = createImageDevelopHandoffProvenanceV1({ origin: { ...origin, schemaVersion: 2 }, original, develop });
	const second = normalizeFramescaperImageSourceV2({ ...first, schemaVersion: 2, develop, developed: { width: 10, height: 5 }, provenance });
	for (const value of [first, second]) assert.equal(JSON.stringify(sourceCurrent(structuredClone(value))), JSON.stringify(value));
	assert.equal(imageDevelopHandoffRecipeSha256V1(develop), digest(develop)); assert.equal(recipeHash(develop), digest(develop));
	assert.throws(() => normalizeFramescaperImageSourceV1(raw())); assert.throws(() => normalizeFramescaperImageSourceV2(raw()));
	assert.throws(() => normalizeFramescaperImageSourceV1OrV2(raw())); assert.throws(() => normalizeImageDevelopHandoffProvenanceV1(raw().provenance));
	assert.throws(() => imageDevelopHandoffRecipeSha256V1(full()));
});
