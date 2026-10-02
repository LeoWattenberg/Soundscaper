/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createCurrentAudioEditorProject, validateCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { CLIP_SOURCE_STRETCH_EXTENSION, type ClipSourceStretchMemory } from '../src/common/editor/clip-source-stretch-memory.ts';
import { normalizeAudioWarpMap } from '../src/common/editor/audio-warp-domain.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';

const NOW = '2026-10-02T12:00:00.000Z';
function fixture() {
	return createCurrentAudioEditorProject({
		id: 'source-edit-project', now: NOW, sampleRate: 48_000,
		sources: [createAudioSource({ id: 'source', name: 'Recording', frameCount: 1_000, channelCount: 1, sampleRate: 48_000 })],
		clips: [
			createAudioClip({ id: 'first', sourceId: 'source', timelineStartFrame: 300, sourceStartFrame: 100, sourceDurationFrames: 200, durationFrames: 200, gain: 0.4, fadeInFrames: 20, pitchCents: 100 }),
			createAudioClip({ id: 'second', sourceId: 'source', timelineStartFrame: 800, sourceStartFrame: 600, sourceDurationFrames: 100, durationFrames: 100, reversed: true }),
		],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['first', 'second'] })],
		projectBin: { clips: [createAudioClip({ id: 'binned', binItemId: 'bin', sourceId: 'source', sourceStartFrame: 0, sourceDurationFrames: 1_000, durationFrames: 1_000 })] },
	});
}
function command(frameCount = 1_000): Extract<AudioEditorCommand, { type: 'source/process-audio' }> {
	return {
		type: 'source/process-audio', sourceId: 'source', startFrame: 100, endFrame: 300,
		source: createAudioSource({ id: 'processed', name: 'Processed recording', frameCount, channelCount: 1, sampleRate: 48_000 }),
	};
}

test('source processing changes every source instance and keeps per-clip controls and selection', () => {
	const before = fixture();
	const after = applyEditorCommand(before, command(), { now: NOW }) as typeof before;
	assert.equal(validateCurrentAudioEditorProject(after), true);
	for (const clip of [...after.clips, ...after.projectBin.clips]) assert.equal(clip.sourceId, 'processed');
	for (const clip of after.clips) {
		const original = before.clips.find((item) => item.id === clip.id)!;
		for (const field of ['timelineStartFrame', 'durationFrames', 'sourceStartFrame', 'sourceDurationFrames', 'gain', 'fadeInFrames', 'pitchCents', 'speedRatio', 'reversed']) {
			assert.deepEqual(clip[field], original[field], field);
		}
	}
	assert.deepEqual(after.selection, before.selection);
	assert.equal(before.clips[0]!.sourceId, 'source');
});

test('length-changing effects remap source spans without moving timeline anchors', () => {
	const before = fixture();
	const after = applyEditorCommand(before, command(1_100), { now: NOW }) as typeof before;
	assert.equal(validateCurrentAudioEditorProject(after), true);
	assert.deepEqual(after.clips.map((clip) => [clip.sourceStartFrame, clip.sourceDurationFrames, clip.durationFrames, clip.timelineStartFrame]), [
		[100, 300, 300, 300], [700, 100, 100, 800],
	]);
	assert.equal(after.clips[0]!.gain, before.clips[0]!.gain);
	assert.equal(after.clips[0]!.pitchCents, before.clips[0]!.pitchCents);
	assert.equal(after.projectBin.clips[0]!.sourceDurationFrames, 1_100);
});

test('source processing refuses channel changes and invalid replacement bounds atomically', () => {
	const project = fixture();
	assert.throws(() => applyEditorCommand(project, { ...command(), source: { ...command().source, channelCount: 2 } } as AudioEditorCommand), /channel/i);
	assert.throws(() => applyEditorCommand(project, { ...command(), endFrame: 1_001 } as AudioEditorCommand), /range/i);
	assert.equal(project.sources.length, 1);
});

test('source processing carries audible and hidden stretch anchors to the replacement samples', () => {
	const project = fixture();
	const point = (outer: number, source: number) => ({ outer: { num: outer, den: 1 }, source: { num: source, den: 1 }, mode: 'forward' as const });
	const warpMap = { feature: 'audio-warp', points: [point(0, 100), point(90, 200), point(200, 300)] };
	const opaqueExtensions = { [CLIP_SOURCE_STRETCH_EXTENSION]: {
		sourceId: 'source', sourceFrameCount: 1_000,
		map: { feature: 'audio-warp', points: [point(0, 0), point(100, 100), point(190, 200), point(300, 300), point(1_000, 1_000)] },
	} };
	const before = createCurrentAudioEditorProject({ ...project, clips: [{ ...project.clips[0], warpMap, opaqueExtensions }, ...project.clips.slice(1)] });
	const after = applyEditorCommand(before, command(1_100), { now: NOW }) as typeof project;
	assert.equal(validateCurrentAudioEditorProject(after), true);
	assert.deepEqual(normalizeAudioWarpMap(after.clips[0]!.warpMap).points.map((item) => item.source.num / item.source.den), [100, 250, 400]);
	const extensions = after.clips[0]!.opaqueExtensions as Readonly<Record<string, unknown>>;
	const memory = extensions[CLIP_SOURCE_STRETCH_EXTENSION] as ClipSourceStretchMemory;
	assert.equal(memory.sourceId, 'processed');
	assert.equal(memory.sourceFrameCount, 1_100);
	assert.deepEqual(memory.map.points.map((item) => item.source.num / item.source.den), [0, 100, 250, 400, 1_100]);
});

test('length-changing source effects rebase musical warp points through intervening tempo changes', () => {
	const point = (outer: number, source: number) => ({ outer: { num: outer, den: 1 }, source: { num: source, den: 1 }, mode: 'forward' as const });
	const source = createAudioSource({ id: 'source', frameCount: 192_000, sampleRate: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'musical', sourceId: 'source', anchor: 'musical', musicalStartBeat: 0,
		musicalExtent: 'beat', musicalDurationBeats: 8, sourceStartFrame: 0, sourceDurationFrames: 96_000,
		warpMap: { feature: 'audio-warp', points: [point(0, 0), point(4, 48_000), point(8, 96_000)] },
	});
	const before = createCurrentAudioEditorProject({ id: 'musical-source', now: NOW, sampleRate: 48_000,
		tempoMap: { mode: 'musical', events: [
			{ id: 'fast', beat: 0, bpm: 120 }, { id: 'slow', beat: 4, bpm: 60 },
		] }, sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'track', clipIds: ['musical'] })],
		projectBin: { clips: [createAudioClip({ ...clip, id: 'binned-musical', binItemId: 'bin' })] },
	});
	const after = applyEditorCommand(before, { type: 'source/process-audio', sourceId: 'source',
		startFrame: 0, endFrame: 96_000, source: createAudioSource({ ...source, id: 'processed', frameCount: 288_000 }),
	}) as typeof before;
	assert.equal(validateCurrentAudioEditorProject(after), true);
	const resolved = projectForRuntimeConsumers(after);
	for (const result of [...resolved.clips, ...resolved.projectBin.clips]) {
		assert.equal(result.durationFrames, 576_000);
		assert.equal(result.timelineStartFrame, 0);
		assert.deepEqual(normalizeAudioWarpMap(result.warpMap).points.map(({ outer, source: sample }) => [outer.num / outer.den, sample.num / sample.den]),
			[[0, 0], [6, 96_000], [14, 192_000]]);
	}
});

test('hidden markers retain their display timing after source effects on another sample grid', () => {
	const point = (outer: number, source: number) => ({ outer: { num: outer, den: 1 }, source: { num: source, den: 1 }, mode: 'forward' as const });
	const source = createAudioSource({ id: 'source', frameCount: 1_000, sampleRate: 24_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'warped', sourceId: 'source', durationFrames: 2_000, sourceDurationFrames: 1_000,
		warpMap: { feature: 'audio-warp', points: [point(0, 0), point(500, 250), point(800, 400), point(1_200, 600), point(2_000, 1_000)] },
	});
	const before = createCurrentAudioEditorProject({ id: 'hidden-markers', now: NOW, sampleRate: 48_000,
		sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'track', clipIds: ['warped'] })],
	});
	const trimmed = applyEditorCommand(before, { type: 'clip/trim', clipId: 'warped', sourceRange: true,
		sourceStartFrame: 400, sourceDurationFrames: 200, durationFrames: 400,
	}) as typeof before;
	const processed = applyEditorCommand(trimmed, { type: 'source/process-audio', sourceId: 'source',
		startFrame: 0, endFrame: 100, source: createAudioSource({ ...source, id: 'processed', frameCount: 1_100 }),
	}) as typeof before;
	const extended = applyEditorCommand(processed, { type: 'clip/trim', clipId: 'warped', sourceRange: true,
		sourceStartFrame: 0, sourceDurationFrames: 1_100, durationFrames: 2_200,
	}) as typeof before;
	assert.equal(validateCurrentAudioEditorProject(extended), true);
	assert.deepEqual(normalizeAudioWarpMap(extended.clips[0]!.warpMap).points.map(({ outer, source: sample }) => [outer.num / outer.den, sample.num / sample.den]),
		[[0, 0], [700, 350], [1_000, 500], [1_400, 700], [2_200, 1_100]]);
});
