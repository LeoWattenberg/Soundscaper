/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	instantiateVideoFinishingPresetV1,
	normalizeVideoFinishingPresetV1,
	normalizeVideoVisualPresentationV1,
} from '../src/common/editor/video-visual-presentation-v27.ts';

const GRADE = Object.freeze({
	schemaVersion: 1,
	exposureStops: 0.5,
	contrast: 1.1,
	pivot: 0.18,
	lift: [0, 0, 0],
	gamma: [1, 1, 1],
	gain: [1, 1, 1],
	saturation: 0.9,
	lut: null,
});

test('visual presentations own one admitted grade and processor/mask references', () => {
	const presentation = normalizeVideoVisualPresentationV1({
		schemaVersion: 1,
		id: 'presentation-1',
		owner: { kind: 'clip', id: 'video-clip' },
		enabled: true,
		opacity: 0.75,
		blendMode: 'screen',
		grade: GRADE,
		processorStackId: 'processor-stack-1',
		maskMatteIds: ['mask-1'],
	});
	assert.equal(presentation.grade?.exposureStops, 0.5);
	assert.equal(Object.isFrozen(presentation.maskMatteIds), true);
	assert.throws(() => normalizeVideoVisualPresentationV1({
		...presentation,
		blendMode: 'native-plugin-blend',
	}), /blend.*unsupported/iu);
});

test('finishing presets copy inert authored values under caller-owned fresh identities', () => {
	const preset = normalizeVideoFinishingPresetV1({
		schemaVersion: 1,
		kind: 'video-finishing-preset',
		id: 'preset-look',
		name: 'Dialogue look',
		template: {
			enabled: true,
			opacity: 0.8,
			blendMode: 'normal',
			grade: GRADE,
		},
	});
	const first = instantiateVideoFinishingPresetV1(preset, {
		presentationId: 'presentation-a', owner: { kind: 'clip', id: 'clip-a' },
	});
	const second = instantiateVideoFinishingPresetV1(preset, {
		presentationId: 'presentation-b', owner: { kind: 'clip', id: 'clip-b' },
	});
	assert.equal(first.id, 'presentation-a');
	assert.equal(second.id, 'presentation-b');
	assert.notStrictEqual(first.grade, preset.template.grade);
	assert.deepEqual(first.grade, preset.template.grade);
	assert.deepEqual(first.maskMatteIds, []);
	assert.equal(first.processorStackId, null);
	assert.throws(() => instantiateVideoFinishingPresetV1(preset, {
		presentationId: preset.id, owner: { kind: 'clip', id: 'clip-a' },
	}), /fresh|identity/iu);
});
