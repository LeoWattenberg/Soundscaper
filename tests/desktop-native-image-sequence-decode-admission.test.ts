/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperNativeImageSequenceDecodePlan,
} from '../desktop/native-image-sequence-decode-admission.ts';
import {
	normalizeNativeMediaImageSequenceSourceV25,
} from '../src/common/editor/native-media-image-sequence-v25.ts';

const RATE = Object.freeze({ num: 60_000, den: 1_001 });
const PACK_SHA256 = 'ab'.repeat(32);
const INVENTORY_SHA256 = 'cd'.repeat(32);

test('decode compatibility planning retains every exact 60000/1001 sequence authority', () => {
	const plan = createFramescaperNativeImageSequenceDecodePlan(
		'project-1', 7, sequenceSource(),
	);
	assert.equal(plan.version, 11);
	assert.deepEqual(plan.output.frameRate, { num: 30, den: 1 },
		'the legacy V11 output cadence is explicitly compatibility-only');
	assert.equal(plan.output.frameCount, 2);
	assert.equal(plan.timebase.sampleRate, 30);
	assert.equal(plan.timebase.sampleDuration, 2);
	assert.deepEqual(plan.timebase.sequenceRate, RATE);
	assert.deepEqual(plan.sources[0]?.timing, {
		kind: 'cfr', frameCount: 2, rate: RATE,
	});
	const professional = plan.nodes.find(({ kind }) => kind === 'professional-media');
	assert.ok(professional?.kind === 'professional-media');
	assert.deepEqual(professional.imageSequence?.frameRate, RATE);
	assert.equal(professional.imageSequence?.frameCount, 2);
});

function sequenceSource() {
	return normalizeNativeMediaImageSequenceSourceV25({
		kind: 'video', sourceType: 'image-sequence', version: 1,
		id: 'sequence-1', name: 'Sequence', stem: 'shot.', extension: 'png',
		frameNumberWidth: 4, firstFrameNumber: 1, lastFrameNumber: 2,
		frameCount: 2, frameRate: RATE,
		inventory: {
			kind: 'image-sequence-inventory', version: 1,
			storageKey: `image-sequence-inventory-sha256:${INVENTORY_SHA256}`,
			sha256: INVENTORY_SHA256, byteLength: 256, frameCount: 2,
			firstFrameNumber: 1, lastFrameNumber: 2,
		},
		sourcePack: {
			kind: 'image-sequence-source-pack',
			storageKey: `image-sequence-pack-sha256:${PACK_SHA256}`,
			sha256: PACK_SHA256, byteLength: 512,
		},
		characteristics: {
			backend: 'framescaper-media-host', codedWidth: 2, codedHeight: 2,
			hasAlpha: false, videoCodec: 'png', bitDepth: 8,
			pixelFormat: 'rgb24', chromaFormat: '4:4:4',
			alphaMode: null, alphaInterpretation: null,
			colour: {
				primaries: 'srgb', transfer: 'iec61966-2-1', matrix: 'rgb', range: 'full',
				masteringDisplay: null, contentLight: null,
			},
		},
	});
}
