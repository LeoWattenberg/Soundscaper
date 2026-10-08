/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { resolveRuntimeClipProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { clipPropertiesMediaRange } from '../src/common/editor/ui/inspector/clip-properties-media-range.ts';
import { evaluateAudioWarpMap, normalizeAudioWarpMap } from '../src/common/editor/audio-warp-domain.ts';

const source = createAudioSource({ id: 'source', storageKey: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
const document = createSoundscaperProject({ id: 'recording', now: '2026-10-09T12:00:00.000Z', sampleRate: 48_000,
	clips: [createAudioClip({ id: 'clip', sourceId: source.id, timelineStartFrame: 1200,
		durationFrames: 48_000, sourceStartFrame: 0, sourceDurationFrames: 48_000,
		warpMap: { feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' },
			{ outer: 24_000, source: 36_000, mode: 'forward' },
			{ outer: 48_000, source: 48_000, mode: 'forward' },
		] } })], sources: [source], tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })] });
const clip = resolveRuntimeClipProjection(document, document.clips[0]!);
const originalDocument = structuredClone(document);

for (const [field, value, expectedStart, expectedSpan, expectedDuration] of [
	['durationFrame', 24_000, 0, 36_000, 24_000],
	['sourceInFrame', 12_000, 12_000, 36_000, 40_000],
] as const) test(`Properties ${field} retains nonlinear source timing through the canonical trim command`, () => {
	const changes = clipPropertiesMediaRange(clip, source.frameCount, field, value, { project: document, source });
	assert.deepEqual(changes, { sourceStartFrame: expectedStart, sourceDurationFrames: expectedSpan, durationFrames: expectedDuration });
	const edited = applySoundscaperProjectCommand(document, { type: 'clip/trim', clipId: clip.id, sourceRange: true, ...changes });
	const result = resolveRuntimeClipProjection(edited, edited.clips[0]!);
	assert.equal(result.timelineStartFrame, clip.timelineStartFrame);
	const map = normalizeAudioWarpMap(result.warpMap);
	const offset = field === 'sourceInFrame' ? 8000 : 0;
	for (const frame of [0, 4800, 9600, 19_200]) {
		assert.deepEqual(evaluateAudioWarpMap(map, frame), evaluateAudioWarpMap(normalizeAudioWarpMap(clip.warpMap), frame + offset));
	}
	assert.deepEqual(document, originalDocument, 'the source document remains available to Undo');
});

test('ordinary native-rate and reverse property trims retain their existing source geometry', () => {
	const ordinary = { ...clip, warpMap: null, sourceDurationFrames: 24_000, durationFrames: 48_000 };
	assert.deepEqual(clipPropertiesMediaRange(ordinary, 48_000, 'durationFrame', 24_000),
		{ sourceStartFrame: 0, sourceDurationFrames: 12_000, durationFrames: 24_000 });
	assert.deepEqual(clipPropertiesMediaRange({ ...ordinary, reversed: true }, 48_000, 'durationFrame', 24_000),
		{ sourceStartFrame: 12_000, sourceDurationFrames: 12_000, durationFrames: 24_000 });
});

test('extending a Properties-trimmed warp restores its hidden source timing without a new source', () => {
	const changes = clipPropertiesMediaRange(clip, source.frameCount, 'durationFrame', 24_000, { project: document, source });
	const shortened = applySoundscaperProjectCommand(document, { type: 'clip/trim', clipId: clip.id, sourceRange: true, ...changes });
	const shortClip = resolveRuntimeClipProjection(shortened, shortened.clips[0]!);
	const restoredChanges = clipPropertiesMediaRange(shortClip, source.frameCount, 'durationFrame', 48_000,
		{ project: shortened, source });
	assert.deepEqual(restoredChanges, { sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000 });
	const restored = applySoundscaperProjectCommand(shortened, { type: 'clip/trim', clipId: clip.id, sourceRange: true, ...restoredChanges });
	assert.deepEqual(normalizeAudioWarpMap(restored.clips[0]!.warpMap), normalizeAudioWarpMap(clip.warpMap));
	assert.deepEqual(restored.sources, document.sources);
});
