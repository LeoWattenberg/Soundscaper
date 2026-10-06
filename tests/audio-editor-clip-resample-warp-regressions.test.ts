/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAddClipCommand, createAddSourceCommand } from '../src/common/editor/commands/factories.ts';
import { createClipboardDescriptor, preparePasteCommand } from '../src/common/editor/commands/clipboard-runtime.js';
import { resampledClipCommands } from '../src/common/editor/controller/track-audio/internal/clip-resample-service.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import type { ControllerClip, ControllerSource } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { apply, createFixture } from './helpers/audio-editor-model-harness.js';

test('resampling a warped source retains its timeline map and exact fractional marker progress', () => {
	let project = createFixture({ frameCount: 100 });
	project = apply(project, createAddClipCommand('track-1', {
		id: 'warped', sourceId: 'source-1', timelineStartFrame: 0,
		sourceStartFrame: 10, sourceDurationFrames: 30, durationFrames: 30,
		warpMap: { feature: 'audio-warp', points: [
			{ outer: 0, source: 10, mode: 'forward' },
			{ outer: 8, source: { num: 21, den: 2 }, mode: 'forward' },
			{ outer: 30, source: 40, mode: 'forward' },
		] },
	}));
	const original = project.sources[0] as ControllerSource;
	const clip = project.clips[0] as unknown as ControllerClip;
	const replacement = { ...original, id: 'replacement', frameCount: 50, sampleRate: 24_000 };
	project = apply(project, createAddSourceCommand(replacement));
	for (const command of resampledClipCommands('track-1', clip, original, replacement, 24_000)) {
		project = apply(project, command);
	}
	const resampled = project.clips[0];
	assert.equal(resampled.durationFrames, 30);
	assert.equal(resampled.sourceStartFrame, 5);
	assert.equal(resampled.sourceDurationFrames, 15);
	assert.deepEqual(resampled.warpMap?.points, [
		{ outer: { num: 0, den: 1 }, source: { num: 5, den: 1 }, mode: 'forward' },
		{ outer: { num: 8, den: 1 }, source: { num: 21, den: 4 }, mode: 'forward' },
		{ outer: { num: 30, den: 1 }, source: { num: 20, den: 1 }, mode: 'forward' },
	]);
});

test('clipboard pasting onto another project sample grid scales only sample-anchored warp outer positions', () => {
	const source = createAudioSource({ id: 'source', frameCount: 100, channelCount: 1, sampleRate: 48_000 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 30,
		sourceStartFrame: 10, sourceDurationFrames: 30, warpMap: { feature: 'audio-warp', points: [
			{ outer: 0, source: 10, mode: 'forward' },
			{ outer: 8, source: { num: 21, den: 2 }, mode: 'forward' },
			{ outer: 30, source: 40, mode: 'forward' },
		] } });
	const origin = createCurrentAudioEditorProject({ sampleRate: 48_000, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })] });
	const destination = createCurrentAudioEditorProject({ sampleRate: 44_100, sources: [source],
		tracks: [createAudioTrack({ id: 'track' })] });
	const clipboard = createClipboardDescriptor(origin, { startFrame: 0, endFrame: 30, trackIds: ['track'] });
	const command = preparePasteCommand(clipboard, { project: destination, atFrame: 50 }, () => 'pasted');
	const result = apply(destination, command).clips[0];
	assert.equal(result.durationFrames, 28);
	assert.equal(result.timelineStartFrame, 50);
	assert.deepEqual(result.warpMap?.points, [
		{ outer: { num: 0, den: 1 }, source: { num: 10, den: 1 }, mode: 'forward' },
		{ outer: { num: 112, den: 15 }, source: { num: 21, den: 2 }, mode: 'forward' },
		{ outer: { num: 28, den: 1 }, source: { num: 40, den: 1 }, mode: 'forward' },
	]);
});
