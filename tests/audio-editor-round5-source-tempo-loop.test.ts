/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createCurrentAudioEditorProject, validateCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { readClipLoop } from '../src/common/editor/audio-clip-loop.ts';

function fixture(sampleRate: number, reversed = false) {
	const frameCount = sampleRate * 0.8;
	const original = createCurrentAudioEditorProject({ id: 'source-tempo', sampleRate: 48_000,
		sources: [createAudioSource({ id: 'source', sampleRate, channelCount: 1, frameCount })],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', timelineStartFrame: 4800,
			sourceDurationFrames: frameCount, durationFrames: 38_400, reversed, gain: 0.4 })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
	});
	const looped = applyEditorCommand(original, { type: 'clip/update', clipId: 'clip',
		changes: { loop: { periodFrames: 38_400, durationFrames: 76_800 } } });
	function process(project: typeof original, factor = 0.5) {
		return applyEditorCommand(project, { type: 'source/process-audio', sourceId: 'source',
			startFrame: 0, endFrame: frameCount,
			source: createAudioSource({ id: 'processed', sampleRate, channelCount: 1, frameCount: frameCount * factor }),
		});
	}
	return { original, looped, process };
}

for (const sampleRate of [24_000, 48_000]) for (const reversed of [false, true]) {
	test(`a ${sampleRate} Hz ${reversed ? 'reversed' : 'forward'} source tempo edit scales the repeat period`, () => {
		const { looped, process } = fixture(sampleRate, reversed);
		const after = process(looped);
		assert.equal(validateCurrentAudioEditorProject(after), true);
		const clip = after.clips[0]!;
		assert.equal(clip.durationFrames, 38_400);
		assert.deepEqual(readClipLoop(clip), { periodFrames: 19_200, offsetFrames: 0 });
		assert.equal(clip.sourceDurationFrames, sampleRate * 0.4);
		assert.equal(clip.timelineStartFrame, 4800);
		assert.equal(clip.gain, 0.4);
		assert.equal(clip.reversed, reversed);
		assert.deepEqual(readClipLoop(looped.clips[0]!), { periodFrames: 38_400, offsetFrames: 0 });
	});
}

test('a tempo edit scales the authored phase of a split loop along with its period', () => {
	const { looped, process } = fixture(24_000);
	const split = applyEditorCommand(looped, { type: 'clip/split', clipId: 'clip', atFrame: 14_400, rightClipId: 'right' });
	assert.deepEqual(readClipLoop(split.clips.find(clip => clip.id === 'right')!), { periodFrames: 38_400, offsetFrames: 9600 });
	const after = process(split);
	assert.equal(validateCurrentAudioEditorProject(after), true);
	const right = after.clips.find(clip => clip.id === 'right')!;
	assert.deepEqual(readClipLoop(right), { periodFrames: 19_200, offsetFrames: 4800 });
	assert.equal(right.durationFrames, 33_600);
	assert.equal(right.timelineStartFrame, 14_400);
});

test('non-loop source edits and equal-length processing retain their existing geometry', () => {
	const { original, looped, process } = fixture(48_000);
	const ordinary = process(original);
	assert.equal(ordinary.clips[0]!.durationFrames, 19_200);
	assert.equal(readClipLoop(ordinary.clips[0]!), null);
	const unchanged = process(looped, 1);
	assert.equal(unchanged.clips[0]!.durationFrames, 76_800);
	assert.deepEqual(readClipLoop(unchanged.clips[0]!), { periodFrames: 38_400, offsetFrames: 0 });
});
