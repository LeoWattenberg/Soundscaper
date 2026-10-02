/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAudioWarpMap } from '../src/common/editor/audio-warp-domain.ts';
import { clipSourceTrimFields } from '../src/common/editor/clip-source-trim.ts';

const project = { sampleRate: 48_000, tempoMap: { mode: 'musical' as const, events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] } };
const source = { sampleRate: 48_000, frameCount: 1000 };
const clip = { kind: 'audio', anchor: 'sample', timelineStartFrame: 1000, sourceStartFrame: 100, sourceDurationFrames: 200, durationFrames: 100, warpMap: {
	feature: 'audio-warp', points: [{ outer: 0, source: 100, mode: 'forward' }, { outer: 75, source: 200, mode: 'forward' }, { outer: 100, source: 300, mode: 'forward' }],
} };

test('source edge trims preserve sample anchors and rebase output within the unchanged project position', () => {
	const result = clipSourceTrimFields(project, clip, source, { sourceStartFrame: 150, sourceDurationFrames: 150, durationFrames: 50 });
	assert.deepEqual(result.warpMap?.points, [
		{ outer: { num: 0, den: 1 }, source: { num: 150, den: 1 }, mode: 'forward' },
		{ outer: { num: 30, den: 1 }, source: { num: 200, den: 1 }, mode: 'forward' },
		{ outer: { num: 50, den: 1 }, source: { num: 300, den: 1 }, mode: 'forward' },
	]);
	assert.equal(clip.timelineStartFrame, 1000);
});

test('extending a source edge preserves interior markers and rejects unavailable media', () => {
	const result = clipSourceTrimFields(project, clip, source, { sourceStartFrame: 0, sourceDurationFrames: 400, durationFrames: 300 });
	assert.deepEqual(result.warpMap?.points.map((point) => point.source.num / point.source.den), [0,100,200,300,400]);
	assert.throws(() => clipSourceTrimFields(project, clip, source, { sourceStartFrame: 900, sourceDurationFrames: 200, durationFrames: 100 }), /exceeds/);
});

test('source trimming changes one grouped instance without moving its timeline anchor or its sibling', async () => {
	const { createSoundscaperProject } = await import('../src/soundscaper/editor-project.ts');
	const { applySoundscaperProjectCommand } = await import('../src/soundscaper/editor-project-commands.ts');
	const { createAudioClip, createAudioSource, createAudioTrack } = await import('../src/common/editor/project-media-factory.ts');
	const { resolveRuntimeClipProjection } = await import('../src/common/editor/runtime-clip-projection.ts');
	const document = createSoundscaperProject({
		id: 'source-trim', now: '2026-10-02T12:00:00.000Z', sampleRate: project.sampleRate, tempoMap: project.tempoMap,
		sources: [createAudioSource({ ...source, id: 'source', storageKey: 'source', channelCount: 1 })],
		clips: [createAudioClip({ ...clip, id: 'clip', sourceId: 'source', groupId: 'group' }), createAudioClip({ id: 'sibling', sourceId: 'source', timelineStartFrame: 2000, durationFrames: 100, sourceStartFrame: 100, sourceDurationFrames: 100, groupId: 'group' })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip', 'sibling'] })],
	});
	const result = applySoundscaperProjectCommand(document, { type: 'clip/trim', clipId: 'clip', sourceRange: true, sourceStartFrame: 150, sourceDurationFrames: 150, durationFrames: 50 });
	const edited = resolveRuntimeClipProjection(result, result.clips[0]!);
	assert.equal(edited.timelineStartFrame, 1000);
	assert.equal(edited.durationFrames, 50);
	assert.equal(edited.sourceStartFrame, 150);
	assert.equal(edited.sourceDurationFrames, 150);
	assert.deepEqual(result.clips[1], document.clips[1]);
});

test('a hidden stretch marker returns on the identical source sample after trim and reopen', () => {
	const initial = { ...clip, sourceId: 'source', opaqueExtensions: { other: 'kept' } };
	const trimmed = { ...initial, ...clipSourceTrimFields(project, initial, source, { sourceStartFrame: 220, sourceDurationFrames: 80, durationFrames: 20 }) };
	assert.equal(normalizeAudioWarpMap(trimmed.warpMap).points.some((point) => point.source.num === 200), false);
	const reopened = JSON.parse(JSON.stringify(trimmed)) as typeof trimmed;
	const restored = clipSourceTrimFields(project, reopened, source, { sourceStartFrame: 100, sourceDurationFrames: 200, durationFrames: 100 });
	assert.equal(restored.warpMap?.points.some((point) => point.source.num === 200 && point.source.den === 1), true);
	assert.equal(restored.opaqueExtensions?.other, 'kept');
});

test('musical source trims keep the beat anchor and sample marker through command reconciliation', async () => {
	const { createSoundscaperProject } = await import('../src/soundscaper/editor-project.ts');
	const { applySoundscaperProjectCommand } = await import('../src/soundscaper/editor-project-commands.ts');
	const { createAudioClip, createAudioSource, createAudioTrack } = await import('../src/common/editor/project-media-factory.ts');
	const { resolveRuntimeClipProjection } = await import('../src/common/editor/runtime-clip-projection.ts');
	const document = createSoundscaperProject({
		id: 'musical-source-trim', now: '2026-10-02T12:00:00.000Z', sampleRate: project.sampleRate, tempoMap: project.tempoMap,
		sources: [createAudioSource({ ...source, id: 'source', storageKey: 'source', channelCount: 1 })],
		clips: [createAudioClip({ ...clip, id: 'clip', sourceId: 'source', anchor: 'musical', musicalExtent: 'beat', musicalStartBeat: { num: 1, den: 24 }, musicalDurationBeats: { num: 1, den: 240 }, warpMap: {
			feature: 'audio-warp', points: [{ outer: 0, source: 100, mode: 'forward' }, { outer: { num: 1, den: 320 }, source: 200, mode: 'forward' }, { outer: { num: 1, den: 240 }, source: 300, mode: 'forward' }],
		} })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
	});
	const result = applySoundscaperProjectCommand(document, { type: 'clip/trim', clipId: 'clip', sourceRange: true, sourceStartFrame: 150, sourceDurationFrames: 150, durationFrames: 50 });
	const persisted = result.clips[0]!;
	const edited = resolveRuntimeClipProjection(result, persisted);
	assert.equal(edited.timelineStartFrame, 1000);
	assert.equal(edited.durationFrames, 50);
	assert.deepEqual(persisted.musicalStartBeat, { num: 1, den: 24 });
	assert.deepEqual(persisted.musicalDurationBeats, { num: 1, den: 480 });
	assert.deepEqual(normalizeAudioWarpMap(persisted.warpMap).points[1], { outer: { num: 1, den: 800 }, source: { num: 200, den: 1 }, mode: 'forward' });
});

test('trimming a source before any stretch marker exists commits JSON-safe clip fields', async () => {
	const { createSoundscaperProject } = await import('../src/soundscaper/editor-project.ts');
	const { applySoundscaperProjectCommand } = await import('../src/soundscaper/editor-project-commands.ts');
	const { createAudioClip, createAudioSource, createAudioTrack } = await import('../src/common/editor/project-media-factory.ts');
	const document = createSoundscaperProject({
		id: 'plain-source-trim', now: '2026-10-02T12:00:00.000Z', sampleRate: project.sampleRate, tempoMap: project.tempoMap,
		sources: [createAudioSource({ ...source, id: 'source', storageKey: 'source', channelCount: 1 })],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', timelineStartFrame: 1000, sourceStartFrame: 0, sourceDurationFrames: 1000, durationFrames: 1000, warpMap: null })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
	});
	const result = applySoundscaperProjectCommand(document, { type: 'clip/trim', clipId: 'clip', sourceRange: true, sourceStartFrame: 12, sourceDurationFrames: 988, durationFrames: 988 });
	assert.equal(result.clips[0]?.sourceStartFrame, 12);
	assert.equal(result.clips[0]?.durationFrames, 988);
	assert.equal(result.clips[0]?.timelineStartFrame, 1000);
	assert.equal(result.clips[0]?.warpMap, null);
	assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});
