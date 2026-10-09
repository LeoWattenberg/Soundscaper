/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { copyImageDevelopSettingsV1 } from '../src/common/editor/imaging/image-develop-settings-v1.ts';
import { copyImageDevelopSettingsV2 } from '../src/common/editor/imaging/image-develop-settings-v2.ts';
import { createImageDevelopPresetV1 } from '../src/common/editor/imaging/image-develop-preset-v1.ts';
import { createImageDevelopPresetV2 } from '../src/common/editor/imaging/image-develop-preset-v2.ts';
import { normalizePhotoDevelopPresetRowV1, photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { normalizePhotoDevelopPresetRowV2, normalizePhotoDevelopPresetRowV1OrV2 } from '../src/lightscaper/storage/photo-develop-preset-row-v2.ts';

const selection = { effectTypes: 'all' as const, geometry: true, localAdjustments: true };
function oldPreset() { return createImageDevelopPresetV1({ schemaVersion: 1, id: 'old', name: 'Original',
	settings: copyImageDevelopSettingsV1({ schemaVersion: 1, selection, develop: defaultImageDevelopStateV1() }) }); }
function newPreset() { return createImageDevelopPresetV2({ schemaVersion: 2, id: 'profile', name: 'LUT',
	settings: copyImageDevelopSettingsV2({ schemaVersion: 2, selection, develop: { ...defaultImageDevelopStateV1(), processVersion: 2,
		effects: [{ id: 'lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut: null } }] } }) }); }
const row = () => ({ schemaVersion: 2, kind: 'photo-develop-presets', catalogId: 'catalog', revision: 29, presets: [newPreset(), oldPreset()] });

test('row2 retains mixed preset identities and exact old row bytes without read-time promotion', () => {
	const current = normalizePhotoDevelopPresetRowV2(row(), 'catalog');
	assert.deepEqual(current.presets.map(preset => preset.schemaVersion), [1, 2]); assert.equal(current.revision, 29);
	assert.deepEqual(normalizePhotoDevelopPresetRowV1OrV2(current, 'catalog'), current);
	const old = { ...row(), schemaVersion: 1, presets: [oldPreset()] }, admitted = normalizePhotoDevelopPresetRowV1(old, 'catalog');
	assert.equal(JSON.stringify(normalizePhotoDevelopPresetRowV1OrV2(old, 'catalog')), JSON.stringify(admitted));
	assert.equal(photoDevelopPresetsKeyV1('catalog'), 'photo-library:develop-presets:v1:catalog');
	assert.throws(() => normalizePhotoDevelopPresetRowV1(current, 'catalog'));
	assert.throws(() => normalizePhotoDevelopPresetRowV2(admitted, 'catalog'));
});

test('positive-empty row2 is retained and never conflated with absence or an initial revision', () => {
	const empty = normalizePhotoDevelopPresetRowV1OrV2({ ...row(), presets: [], revision: 2 }, 'catalog');
	assert.equal(empty.schemaVersion, 2); assert.equal(empty.revision, 2); assert.deepEqual(empty.presets, []);
	for (const value of [null, undefined, { ...row(), revision: 0 }, { ...row(), schemaVersion: 3 }, { ...row(), catalogId: 'other' }]) {
		assert.throws(() => normalizePhotoDevelopPresetRowV1OrV2(value, 'catalog'));
	}
});

test('closed row admission detaches the complete body and refuses accessors, collisions and all ceilings', () => {
	const input = row(), current = normalizePhotoDevelopPresetRowV2(input, 'catalog'); input.presets.length = 0;
	assert.equal(current.presets.length, 2); assert.ok(Object.isFrozen(current.presets));
	let reads = 0; const accessor = Object.defineProperty(row(), 'presets', { enumerable: true, get() { reads++; return []; } });
	for (const value of [accessor, { ...row(), rawBody: 'cube' }, { ...row(), presets: Array(17).fill(oldPreset()) },
		{ ...row(), presets: [oldPreset(), oldPreset()] }, { ...row(), revision: Number.MAX_SAFE_INTEGER + 1 }]) {
		assert.throws(() => normalizePhotoDevelopPresetRowV2(value, 'catalog'));
	}
	assert.equal(reads, 0);
});

test('individually legal process2 presets cannot exceed the unchanged aggregate row byte ceiling', () => {
	const point = { position: { x: 0.1234567890123456, y: 0.1234567890123456 }, inHandle: null, outHandle: null };
	const settings = copyImageDevelopSettingsV2({ schemaVersion: 2, selection, develop: {
		...defaultImageDevelopStateV1(), processVersion: 2,
		effects: [{ id: 'lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut: null } }],
		masks: [{ schemaVersion: 1, id: 'path', kind: 'mask', inputs: [], outputNodeId: 'node', nodes: [{ id: 'node', kind: 'vector-path',
			fillRule: 'nonzero', paths: [{ id: 'outline', closed: true, points: Array.from({ length: 16_384 }, () => point) }] }] }],
	} });
	const presets = Array.from({ length: 8 }, (_, index) => createImageDevelopPresetV2({ schemaVersion: 2,
		id: `large-${String(index)}`, name: 'Large', settings }));
	assert.ok(new TextEncoder().encode(JSON.stringify(presets[0])).byteLength < 2_097_152);
	assert.ok(new TextEncoder().encode(JSON.stringify(presets)).byteLength > 10_485_760);
	assert.throws(() => normalizePhotoDevelopPresetRowV2({ ...row(), presets }, 'catalog'), /UTF8 byte bound/iu);
});
