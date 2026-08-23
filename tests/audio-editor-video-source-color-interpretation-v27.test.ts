/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	deriveVideoSourceColorInterpretationV1,
} from '../src/common/editor/video-source-color-interpretation-v27.ts';

test('reported source tags map to canonical managed-SDR metadata identity', () => {
	assert.deepEqual(deriveVideoSourceColorInterpretationV1(videoSource({
		primaries: 'BT.709', transfer: 'IEC 61966-2-1', matrix: 'GBR', range: 'full',
	})), {
		schemaVersion: 1,
		sourceId: 'video-source',
		sourceKind: 'video',
		primaries: 'bt709',
		transfer: 'srgb',
		matrix: 'rgb',
		range: 'full',
		provenance: 'metadata',
	});
});

test('HDR, wide-gamut, and partial reported identity is retained without guessing', () => {
	assert.deepEqual(deriveVideoSourceColorInterpretationV1(videoSource({
		primaries: 'bt2020', transfer: 'smpte2084', matrix: 'bt2020nc', range: 'limited',
	})), {
		schemaVersion: 1,
		sourceId: 'video-source',
		sourceKind: 'video',
		primaries: 'bt2020',
		transfer: 'pq',
		matrix: 'bt2020-ncl',
		range: 'limited',
		provenance: 'metadata',
	});
	assert.deepEqual(deriveVideoSourceColorInterpretationV1(videoSource({
		primaries: 'smpte432', transfer: null, matrix: 'unrecognized-matrix', range: null,
	})), {
		schemaVersion: 1,
		sourceId: 'video-source',
		sourceKind: 'video',
		primaries: 'display-p3',
		transfer: 'unknown',
		matrix: 'unknown',
		range: 'unknown',
		provenance: 'metadata',
	});
});

test('unreported current and legacy media keep their disclosed assumptions', () => {
	assert.equal(
		deriveVideoSourceColorInterpretationV1(videoSource(null)).provenance,
		'default-video-bt709-limited',
	);
	assert.equal(deriveVideoSourceColorInterpretationV1(videoSource(null), {
		unreported: 'legacy-unmanaged-encoded',
	}).provenance, 'legacy-unmanaged-encoded');
	assert.deepEqual(deriveVideoSourceColorInterpretationV1({
		id: 'still-source', kind: 'still',
	}), {
		schemaVersion: 1,
		sourceId: 'still-source',
		sourceKind: 'still',
		primaries: 'srgb',
		transfer: 'srgb',
		matrix: 'rgb',
		range: 'full',
		provenance: 'default-still-srgb-full',
	});
});

function videoSource(colour: Readonly<Record<string, unknown>> | null) {
	return {
		id: 'video-source', kind: 'video',
		characteristics: {
			backend: null, codedWidth: null, codedHeight: null, rotationDegrees: null,
			pixelAspectRatio: null, fieldOrder: null, hasAlpha: null, videoCodec: null,
			colour: colour ?? { primaries: null, transfer: null, matrix: null, range: null },
			audioStreams: null, extractedAudioStreamIndex: null, startTimecode: null,
		},
	};
}
