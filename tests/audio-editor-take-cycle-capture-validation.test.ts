/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	normalizeTakeCycleCapturePassIdentities,
	normalizeTakeCycleCaptureSourceBase,
	normalizeTakeCycleLaneTarget,
} from '../src/common/editor/controller/recording/internal/take-cycle/take-cycle-capture-validation.ts';

test('take-cycle capture validation owns target, pass, and source normalization', () => {
	const target = normalizeTakeCycleLaneTarget({ trackId: 'track', sequenceId: 'sequence' });
	assert.deepEqual(target, { trackId: 'track', sequenceId: 'sequence' });
	assert.equal(Object.isFrozen(target), true);

	const identities = normalizeTakeCycleCapturePassIdentities({
		laneId: 'lane', takeId: 'take', mediaId: 'media', journalId: 'journal',
	});
	assert.deepEqual(identities, {
		laneId: 'lane', takeId: 'take', mediaId: 'media', journalId: 'journal',
	});
	assert.equal(Object.isFrozen(identities), true);

	const source = normalizeTakeCycleCaptureSourceBase({
		name: 'Captured audio', sampleRate: 768_000, channelCount: 64, chunkFrames: 16_384,
	});
	assert.deepEqual(source, {
		name: 'Captured audio', sampleRate: 768_000, channelCount: 64, chunkFrames: 16_384,
	});
	assert.equal(Object.isFrozen(source), true);
});

test('take-cycle source normalization enforces codec and memory geometry', () => {
	const source = {
		name: 'Captured audio', sampleRate: 48_000, channelCount: 1, chunkFrames: 65_536,
	};
	assert.deepEqual(normalizeTakeCycleCaptureSourceBase(source), source);
	for (const invalid of [
		{ ...source, sampleRate: 768_001 },
		{ ...source, channelCount: 65 },
		{ ...source, chunkFrames: 65_537 },
		{ ...source, channelCount: 64, chunkFrames: 65_536 },
	]) {
		assert.throws(() => normalizeTakeCycleCaptureSourceBase(invalid), RangeError);
	}
});
