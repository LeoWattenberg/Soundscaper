/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	inspectTakeCyclePcmEvidenceAllocationProbe,
	resetTakeCyclePcmEvidenceAllocationProbe,
} from '../src/common/editor/controller/take-cycle-capture-pcm-evidence.ts';
import { collectTakeCycleLivePassEvidence } from '../src/common/editor/controller/take-cycle-live-pass-evidence.ts';
import { TAKE_CYCLE_CAPTURE_MAXIMUM_PASSES } from '../src/common/editor/take-cycle-capture-domain.ts';

test('maximum-pass evidence keeps only one chunk accumulator live at a time', async () => {
	resetTakeCyclePcmEvidenceAllocationProbe();
	const captureSpans = Array.from({ length: TAKE_CYCLE_CAPTURE_MAXIMUM_PASSES }, (_, startSample) => ({
		startSample, endSample: startSample + 1,
	}));
	const evidence = await collectTakeCycleLivePassEvidence({
		chunks: (async function* () {
			for (let index = 0; index < TAKE_CYCLE_CAPTURE_MAXIMUM_PASSES; index += 1) {
				yield Object.freeze({
					index, frames: 1, channels: Object.freeze([Float32Array.of(index % 2)]), timing: null,
				});
			}
		})(),
		captureSpans,
		loopStartSample: 0,
		loopEndSample: 1,
		passCount: TAKE_CYCLE_CAPTURE_MAXIMUM_PASSES,
		channelCount: 1,
		chunkFrames: 4,
	});

	assert.equal(evidence.length, TAKE_CYCLE_CAPTURE_MAXIMUM_PASSES);
	assert.deepEqual(inspectTakeCyclePcmEvidenceAllocationProbe(), {
		activeBytes: 0,
		peakBytes: 4 * Float32Array.BYTES_PER_ELEMENT,
	});
});
