/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoClip, createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { projectBinTransformBadges } from '../src/common/editor/ui/workspace/project-bin-model.ts';

const source = createVideoSource({ id: 'camera', storageKey: 'camera', sampleFrameCount: 48_000,
	frameRate: { num: 30, den: 1 }, sourceFrameCount: 30, width: 96, height: 54, hasAudio: false });
const context = { source, projectSampleRate: 48_000, sequence: { id: 'main', rate: { num: 25, den: 1 } } };
function cameraClip(sourceInFrame: number, sourceFrameCount: number, sequenceFrameCount = 25) {
	return createVideoClip({ id: 'take', sourceId: source.id, sourceInFrame, sourceFrameCount,
		sequenceStartFrame: 0, sequenceFrameCount, binItemId: 'take' }, context);
}

test('a native camera excerpt names its left source trim in the Project Bin', () => {
	assert.deepEqual(projectBinTransformBadges(cameraClip(12, 18), source, {}), ['trim']);
});

test('a native camera excerpt names its right source trim in the Project Bin', () => {
	assert.deepEqual(projectBinTransformBadges(cameraClip(0, 12), source, {}), ['trim']);
});

test('the complete source remains untrimmed at a different sequence rate and playback duration', () => {
	assert.deepEqual(projectBinTransformBadges(cameraClip(0, 30), source, {}), []);
	assert.deepEqual(projectBinTransformBadges(cameraClip(0, 30, 50), source, {}), []);
	assert.deepEqual(projectBinTransformBadges(cameraClip(12, 18), null, { projectBinTransformTrim: 'beschnitten' }), ['beschnitten']);
});

test('legacy audio source bounds retain their existing prefix and suffix badges', () => {
	assert.deepEqual(projectBinTransformBadges({ id: 'audio', sourceStartFrame: 0, sourceDurationFrames: 48_000 },
		{ frameCount: 48_000 }, {}), []);
	assert.deepEqual(projectBinTransformBadges({ id: 'audio', sourceStartFrame: 12_000, sourceDurationFrames: 36_000 },
		{ frameCount: 48_000 }, {}), ['trim']);
	assert.deepEqual(projectBinTransformBadges({ id: 'audio', sourceStartFrame: 0, sourceDurationFrames: 36_000 },
		{ frameCount: 48_000 }, {}), ['trim']);
});
