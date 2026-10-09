/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { copyImageDevelopSettingsV1 } from '../src/common/editor/imaging/image-develop-settings-v1.ts';
import { copyImageDevelopSettingsV2 } from '../src/common/editor/imaging/image-develop-settings-v2.ts';
import { createImageDevelopPresetV1, normalizeImageDevelopPresetV1, serializeImageDevelopPresetV1 } from '../src/common/editor/imaging/image-develop-preset-v1.ts';
import { createImageDevelopPresetV2, normalizeImageDevelopPresetV2, normalizeImageDevelopPresetV1OrV2, applyImageDevelopPresetV2,
	parseImageDevelopPresetV2, serializeImageDevelopPresetV2, parseImageDevelopPresetV1OrV2, serializeImageDevelopPresetV1OrV2 } from '../src/common/editor/imaging/image-develop-preset-v2.ts';
import { normalizeVideoVisualPresetV1 } from '../src/common/editor/video-visual-preset-v24.ts';

const all = { effectTypes: 'all' as const, geometry: true, localAdjustments: true };
const partial = { effectTypes: ['cube-lut-profile-v1'], geometry: false, localAdjustments: false };
const ref = () => ({ storageKey: `lut-sha256:${'4'.repeat(64)}`, sha256: '4'.repeat(64), byteLength: 88, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] });
const develop = () => ({ ...defaultImageDevelopStateV1(), processVersion: 2,
	effects: [{ id: 'lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut: ref() } }] });
const create = (selection: typeof all | typeof partial = all) => createImageDevelopPresetV2({ schemaVersion: 2, id: 'preset', name: 'Profile',
	settings: copyImageDevelopSettingsV2({ schemaVersion: 2, develop: develop(), selection }) });

test('preset2 uses the unchanged scalar identity and independently binds exact selected reference bytes', () => {
	for (const selection of [all, partial]) {
		const preset = create(selection), text = JSON.stringify(preset.settings);
		assert.equal(preset.schemaVersion, 2); assert.equal(preset.kind, 'image-develop-preset');
		assert.deepEqual(normalizeVideoVisualPresetV1(preset.identity), preset.identity);
		assert.equal(preset.identity.authoredStateSha256, createHash('sha256').update(text).digest('hex'));
		assert.deepEqual(preset.settings.develop.effects[0]?.params.lut, ref());
		assert.equal(preset.settings.develop.effects[0]?.enabled, false);
		const changed = JSON.parse(JSON.stringify(preset)) as typeof preset;
		(changed.settings.develop.effects[0]!.params.lut as { byteLength: number }).byteLength++;
		assert.throws(() => normalizeImageDevelopPresetV2(changed), /digest/iu);
		for (const lut of [{ ...ref(), size: 3 }, { ...ref(), domainMin: [-1, 0, 0] }, { ...ref(), domainMax: [2, 1, 1] }, null]) {
			const settings = copyImageDevelopSettingsV2({ schemaVersion: 2, selection, develop: { ...develop(),
				effects: [{ ...develop().effects[0]!, params: { lut } }] } });
			assert.throws(() => normalizeImageDevelopPresetV2({ ...preset, settings }), /digest/iu);
		}
		assert.deepEqual(parseImageDevelopPresetV2(serializeImageDevelopPresetV2(preset)), preset);
	}
});

test('explicit body dispatch preserves the old pinned digest and every serialized V1 byte', () => {
	const old = createImageDevelopPresetV1({ schemaVersion: 1, id: 'preset', name: 'Profile',
		settings: copyImageDevelopSettingsV1({ schemaVersion: 1, develop: defaultImageDevelopStateV1(), selection: all }) });
	assert.equal(old.identity.authoredStateSha256, 'b272353c51e445ebda2dd44a9222ab26095026544b022d047cbcc3281d14484d');
	assert.equal(serializeImageDevelopPresetV1OrV2(old), serializeImageDevelopPresetV1(old));
	assert.deepEqual(parseImageDevelopPresetV1OrV2(serializeImageDevelopPresetV1(old)), old);
	assert.throws(() => normalizeImageDevelopPresetV1(create()));
	assert.throws(() => normalizeImageDevelopPresetV2(old));
	assert.equal(normalizeImageDevelopPresetV1OrV2(create()).schemaVersion, 2);
	for (const schemaVersion of [0, 3, '2', null]) assert.throws(() => normalizeImageDevelopPresetV1OrV2({ ...create(), schemaVersion }));
});

test('full and partial application preserve target order and promote only actual retained profiles', () => {
	const target = { ...defaultImageDevelopStateV1(), effects: [{ id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: 2 } }],
		geometry: { crop: null, rotationDegrees: 15, flipHorizontal: true, flipVertical: false } };
	const partialResult = applyImageDevelopPresetV2({ schemaVersion: 2, target, preset: create(partial) });
	assert.deepEqual(partialResult.effects.map(effect => effect.id), ['tone', 'lut']); assert.equal(partialResult.processVersion, 2);
	assert.deepEqual(partialResult.geometry, target.geometry);
	assert.deepEqual(applyImageDevelopPresetV2({ schemaVersion: 2, target: partialResult, preset: create(partial) }), partialResult);
	assert.deepEqual(applyImageDevelopPresetV2({ schemaVersion: 2, target, preset: create() }), create().settings.develop);
	const neutral = createImageDevelopPresetV2({ schemaVersion: 2, id: 'neutral', name: 'Neutral',
		settings: copyImageDevelopSettingsV2({ schemaVersion: 2, selection: all, develop: { ...develop(), effects: [{ ...develop().effects[0]!, params: { lut: null } }] } }) });
	assert.equal(parseImageDevelopPresetV2(serializeImageDevelopPresetV2(neutral)).settings.develop.effects[0]?.params.lut, null);
});

test('preset admission refuses hidden payloads, raw body authority, accessors and literal byte overflow', () => {
	const preset = create(partial); let reads = 0;
	const accessor = Object.defineProperty({ ...preset }, 'settings', { enumerable: true, get() { reads++; return preset.settings; } });
	for (const value of [accessor, { ...preset, catalogId: 'foreign' }, { ...preset, body: 'LUT_3D_SIZE 2' },
		{ ...preset, settings: { ...preset.settings, selection: { ...partial, effectTypes: [] } } },
		{ ...preset, identity: { ...preset.identity, modelKind: 'generator' } }]) assert.throws(() => normalizeImageDevelopPresetV2(value));
	assert.equal(reads, 0);
	assert.throws(() => parseImageDevelopPresetV2('é'.repeat(1_048_577)), /byte budget/iu);
	assert.throws(() => parseImageDevelopPresetV1OrV2(' '.repeat(2_097_153)), /byte budget/iu);
	assert.throws(() => parseImageDevelopPresetV2('{'), SyntaxError);
});
