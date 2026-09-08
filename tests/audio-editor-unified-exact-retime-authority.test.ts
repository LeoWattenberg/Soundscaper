/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertUnifiedExactRetimeAuthority } from '../src/common/editor/unified-exact-retime-authority.ts';
import { createVideoRetimeExportIntentV6 } from '../src/common/editor/video-retime-export-plan.ts';
import {
	baseInput,
	bindCfrTiming,
	videoClip,
} from './helpers/video-retime-export-fixtures.ts';

const SEQUENCE_RATE = Object.freeze({ num: 60, den: 1 });
const OUTPUT_RATE = Object.freeze({ num: 24, den: 1 });

test('retime authority accepts a geometric clip that spans no output ordinal', () => {
	const canonicalClip = videoClip('brief', 'source', null, {
		sequenceStartFrame: 3,
		sequenceFrameCount: 1,
		sourceInFrame: 3,
		sourceFrameCount: 1,
	});
	const intent = createVideoRetimeExportIntentV6(baseInput({
		sampleStart: 0,
		sampleDuration: 4_800,
		sampleRate: 48_000,
		sequenceBinding: { id: 'sequence-1', rate: SEQUENCE_RATE },
		outputRate: OUTPUT_RATE,
		topology: [
			{ startSample: 0, endSample: 2_400, layers: [] },
			{ startSample: 2_400, endSample: 3_200, layers: [{ clips: [{ clipId: 'brief' }] }] },
			{ startSample: 3_200, endSample: 4_800, layers: [] },
		],
		canonicalClips: [canonicalClip],
	}), new Map([['source', bindCfrTiming('source', 100, SEQUENCE_RATE)]]));

	assert.deepEqual(intent.intersections, []);
	assert.equal(intent.limits.geometricCandidateCount, 1);
	assert.doesNotThrow(() => assertUnifiedExactRetimeAuthority(intent, {
		sampleStart: 0,
		sampleDuration: 4_800,
		sampleRate: 48_000,
		sequenceId: 'sequence-1',
		sequenceRate: SEQUENCE_RATE,
		outputRate: OUTPUT_RATE,
		outputFrameCount: intent.outputFrameCount,
	}, {
		clipId: 'brief',
		sourceId: 'source',
		sequenceStartFrame: 3,
		sequenceFrameCount: 1,
		sourceInFrame: 3,
		sourceFrameCount: 1,
		sourceRate: SEQUENCE_RATE,
		retimeMap: null,
		sourceTiming: { kind: 'cfr' },
		sourceTimingView: null,
	}));
});
