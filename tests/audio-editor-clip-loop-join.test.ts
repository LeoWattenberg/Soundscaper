/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { readClipLoop } from '../src/common/editor/audio-clip-loop.ts';

function createLoopProject(reversed: boolean) {
	const source = createAudioSource({ id: 'source', storageKey: 'source', frameCount: 1_000, sampleRate: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, timelineStartFrame: 0,
		sourceStartFrame: 20, sourceDurationFrames: 200, durationFrames: 100, speedRatio: 2, reversed });
	const project = createCurrentAudioEditorProject({ id: 'loop-join-project', sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })] });
	return applyEditorCommand(project, { type: 'clip/update', clipId: clip.id,
		changes: { loop: { periodFrames: 100, durationFrames: 350 } } });
}

for (const reversed of [false, true]) {
	for (const splitFrame of [50, 125]) {
		test(`split and rejoin restore a ${reversed ? 'reversed' : 'forward'} loop at frame ${splitFrame}`, () => {
			const project = createLoopProject(reversed);
			const split = applyEditorCommand(project, { type: 'clip/split', clipId: 'clip', atFrame: splitFrame, rightClipId: 'right' });
			const joined = applyEditorCommand(split, { type: 'clip/join', clipIds: ['clip', 'right'] });
			assert.equal(joined.clips.length, 1);
			assert.equal(joined.clips[0]!.sourceStartFrame, 20);
			assert.equal(joined.clips[0]!.sourceDurationFrames, 200);
			assert.equal(joined.clips[0]!.durationFrames, 350);
			assert.deepEqual(readClipLoop(joined.clips[0]!), { periodFrames: 100, offsetFrames: 0 });
		});
	}
}

test('joining multiple loop parts preserves partial outer repetitions', () => {
	let project = createLoopProject(false);
	project = applyEditorCommand(project, { type: 'clip/split', clipId: 'clip', atFrame: 25, rightClipId: 'second' });
	project = applyEditorCommand(project, { type: 'clip/split', clipId: 'second', atFrame: 125, rightClipId: 'third' });
	project = applyEditorCommand(project, { type: 'clip/split', clipId: 'third', atFrame: 275, rightClipId: 'fourth' });
	const joined = applyEditorCommand(project, { type: 'clip/join', clipIds: ['second', 'third', 'fourth'] });
	assert.equal(joined.clips.length, 2);
	const loop = joined.clips.find((clip) => clip.id === 'second')!;
	assert.equal(loop.durationFrames, 325);
	assert.equal(loop.sourceDurationFrames, 200);
	assert.deepEqual(readClipLoop(loop), { periodFrames: 100, offsetFrames: 25 });
});

test('loop parts with an independently edited phase remain unavailable for a lossless join', () => {
	const project = createLoopProject(false);
	let split = applyEditorCommand(project, { type: 'clip/split', clipId: 'clip', atFrame: 125, rightClipId: 'right' });
	split = applyEditorCommand(split, { type: 'clip/update', clipId: 'right', changes: { loop: { periodFrames: 100, offsetFrames: 26 } } });
	assert.throws(() => applyEditorCommand(split, { type: 'clip/join', clipIds: ['clip', 'right'] }), /periods and phases/u);
});
