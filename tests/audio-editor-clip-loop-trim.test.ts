/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { clipHasLoopRepeats, clipLoopUpdateFields, normalizeInactiveClipLoop, readClipLoop, trimClipLoopPeriod, type LoopAudioClip } from '../src/common/editor/audio-clip-loop.ts';
import { projectUnwarpedClipSourceRange } from '../src/common/editor/audio-clip-source-projection.ts';
import { createClipTransformService } from '../src/common/editor/controller/clip-video/internal/clip/clip-transform-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createClipTrimPreview } from '../src/common/editor/ui/timeline/interaction-helpers.js';

const original = { id: 'clip', kind: 'audio', anchor: 'sample', timelineStartFrame: 100,
	durationFrames: 100, sourceId: 'source', sourceStartFrame: 20, sourceDurationFrames: 200,
	reversed: false, opaqueExtensions: { other: 'kept' } };
const looped = { ...original, ...clipLoopUpdateFields(original, { periodFrames: 100, durationFrames: 400 }) };
const legacyLoop = (durationFrames: number, offsetFrames = 0) => ({ ...original, durationFrames,
	opaqueExtensions: { ...original.opaqueExtensions, 'org.soundscaper.clip-loop/v1': { periodFrames: 100, offsetFrames } } });

function projectFixture(clip: LoopAudioClip & { id: string; sourceId: string }, sourceFrameCount = 1000) {
	return createSoundscaperProject({
		sources: [createAudioSource({ id: 'source', storageKey: 'source', sampleRate: 48000, channelCount: 1, frameCount: sourceFrameCount })],
		clips: [createAudioClip({ ...clip })], tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
	});
}

test('only playback crossing a repetition boundary uses loop-period trimming', () => {
	assert.equal(clipHasLoopRepeats(original), false);
	assert.equal(clipHasLoopRepeats(legacyLoop(100)), false);
	assert.equal(clipHasLoopRepeats(legacyLoop(101)), true);
	assert.equal(clipHasLoopRepeats(legacyLoop(75, 25)), false);
	assert.equal(clipHasLoopRepeats(legacyLoop(76, 25)), true);
});

test('returning a four-repeat clip to one pass removes loop metadata without changing its source or speed', () => {
	const single = { ...looped, ...clipLoopUpdateFields(looped, { periodFrames: 100, durationFrames: 100 }) };
	assert.equal(readClipLoop(single), null);
	assert.equal(single.durationFrames, 100);
	assert.equal(single.sourceStartFrame, 20);
	assert.equal(single.sourceDurationFrames, 200);
	assert.equal(single.opaqueExtensions.other, 'kept');
	assert.equal(readClipLoop({ ...original, ...clipLoopUpdateFields(original, true) }), null);
});

test('single-pass normalization keeps the audible phase and source rate for forward and reversed partial clips', () => {
	for (const reversed of [false, true]) {
		const updated = { ...looped, reversed, ...clipLoopUpdateFields({ ...looped, reversed }, { periodFrames: 100, offsetFrames: 25, durationFrames: 50 }) };
		assert.equal(readClipLoop(updated), null);
		assert.equal(updated.durationFrames, 50);
		assert.equal(updated.sourceDurationFrames, 100);
		assert.equal(updated.sourceStartFrame, 70);
	}
	const crossing = { ...looped, ...clipLoopUpdateFields(looped, { periodFrames: 100, offsetFrames: 25, durationFrames: 76 }) };
	assert.deepEqual(readClipLoop(crossing), { periodFrames: 100, offsetFrames: 25 });
});

test('normalizing the final fragment of a slowed single-sample source stays within its source bounds', () => {
	for (const reversed of [false, true]) {
		const fragment = { ...legacyLoop(1, 99), sourceStartFrame: 0, sourceDurationFrames: 1, reversed };
		const normalized = normalizeInactiveClipLoop(fragment);
		assert.equal(normalized.durationFrames, 1);
		assert.equal(normalized.sourceStartFrame, 0);
		assert.equal(normalized.sourceDurationFrames, 1);
		assert.equal(readClipLoop(normalized), null);
		const updated = { ...fragment, ...clipLoopUpdateFields(fragment, { periodFrames: 100, offsetFrames: 99, durationFrames: 1 }) };
		assert.equal(updated.sourceStartFrame, 0);
		assert.equal(updated.sourceDurationFrames, 1);
	}
});

test('splitting the final frame of a slowed single-sample loop retains that sample in either playback direction', () => {
	for (const reversed of [false, true]) {
		const slow = { ...original, sourceStartFrame: 0, sourceDurationFrames: 1, reversed };
		const repeated = { ...slow, ...clipLoopUpdateFields(slow, { periodFrames: 100, durationFrames: 200 }) };
		const split = applySoundscaperProjectCommand(projectFixture(repeated, 1), { type: 'clip/split', clipId: 'clip', atFrame: 199, rightClipId: 'tail' });
		const isolated = applySoundscaperProjectCommand(split, { type: 'clip/split', clipId: 'tail', atFrame: 200, rightClipId: 'remaining' });
		const fragment = isolated.clips.find(clip => clip.id === 'tail')!;
		assert.equal(fragment.durationFrames, 1);
		assert.equal(fragment.sourceStartFrame, 0);
		assert.equal(fragment.sourceDurationFrames, 1);
		assert.equal(readClipLoop(fragment), null);
	}
});

test('extending the loop period until it covers the whole clip restores ordinary trim semantics', () => {
	const update = trimClipLoopPeriod(looped, 1000, 'right', 350);
	const single = { ...looped, ...clipLoopUpdateFields(looped, update) };
	assert.equal(single.durationFrames, 400);
	assert.equal(single.sourceDurationFrames, 800);
	assert.equal(readClipLoop(single), null);
	assert.equal(clipHasLoopRepeats(single), false);
});

test('controller trimming resizes ordinary clips before and after a loop is expanded and returned to one pass', () => {
	let document = projectFixture(original);
	const service = createClipTransformService({
		lifetime: { assertActive() {} }, copy: { audioClipNotFound: 'Missing clip', track: 'Track', timelineFramesFinite: 'Invalid frame' },
		getProject: () => resolveRuntimeProjectProjection(document) as unknown as ClipTransformProject,
		getSelectedClipId: () => 'clip', editingBlocked: () => false, createId: prefix => `${prefix}-new`,
		snapTimelineFrame: frame => Number(frame), activeSelection: () => null,
		commit: command => { document = applySoundscaperProjectCommand(document, command); return document; },
	});
	service.trimClips('clip', { durationFrames: 80 });
	assert.equal(document.clips[0]!.durationFrames, 80);
	assert.equal(document.clips[0]!.sourceDurationFrames, 160);
	document = applySoundscaperProjectCommand(document, { type: 'clip/update', clipId: 'clip', changes: { loop: { periodFrames: 80, durationFrames: 320 } } });
	service.trimClips('clip', { durationFrames: 300 });
	assert.equal(document.clips[0]!.durationFrames, 320);
	assert.equal(readClipLoop(document.clips[0]!)?.periodFrames, 60);
	document = applySoundscaperProjectCommand(document, { type: 'clip/update', clipId: 'clip', changes: { loop: { periodFrames: 60, durationFrames: 60 } } });
	service.trimClips('clip', { durationFrames: 40 });
	assert.equal(document.clips[0]!.durationFrames, 40);
	assert.equal(document.clips[0]!.sourceDurationFrames, 80);
	assert.equal(readClipLoop(document.clips[0]!), null);
});

test('legacy single-pass clip trims remove stale metadata and preserve the audible source speed', () => {
	const document = projectFixture(legacyLoop(50, 25));
	const trimmed = applySoundscaperProjectCommand(document, { type: 'clip/trim', clipId: 'clip', durationFrames: 25 });
	assert.equal(trimmed.clips[0]!.durationFrames, 25);
	assert.equal(trimmed.clips[0]!.sourceStartFrame, 70);
	assert.equal(trimmed.clips[0]!.sourceDurationFrames, 50);
	assert.equal(readClipLoop(trimmed.clips[0]!), null);
	const sourceTrimmed = applySoundscaperProjectCommand(document, { type: 'clip/trim', clipId: 'clip', sourceRange: true, durationFrames: 25, sourceStartFrame: 70, sourceDurationFrames: 50 });
	assert.equal(sourceTrimmed.clips[0]!.durationFrames, 25);
	assert.equal(readClipLoop(sourceTrimmed.clips[0]!), null);
});

test('legacy single-pass controller geometry uses its audible media when trimming either edge', () => {
	for (const left of [false, true]) {
		let document = projectFixture(legacyLoop(50, 25));
		const service = createClipTransformService({
			lifetime: { assertActive() {} }, copy: { audioClipNotFound: 'Missing clip', track: 'Track', timelineFramesFinite: 'Invalid frame' },
			getProject: () => resolveRuntimeProjectProjection(document) as unknown as ClipTransformProject,
			getSelectedClipId: () => 'clip', editingBlocked: () => false, createId: prefix => `${prefix}-new`,
			snapTimelineFrame: frame => Number(frame), activeSelection: () => null,
			commit: command => { document = applySoundscaperProjectCommand(document, command); return document; },
		});
		service.trimClips('clip', { durationFrames: 25, ...(left ? { timelineStartFrame: 125 } : {}) });
		assert.equal(document.clips[0]!.durationFrames, 25);
		assert.equal(document.clips[0]!.sourceDurationFrames, 50);
		assert.equal(document.clips[0]!.sourceStartFrame, left ? 120 : 70);
		assert.equal(readClipLoop(document.clips[0]!), null);
	}
});

test('ordinary trim previews replace legacy single-pass metadata and match the committed source projection', () => {
	const clip = legacyLoop(50, 25);
	const index = { sourceById: new Map([['source', { frameCount: 1000 }]]), trackByClipId: new Map([['clip', { id: 'track' }]]) };
	for (const original of [clip, normalizeInactiveClipLoop(clip)]) {
		const preview = createClipTrimPreview(index, { clipId: 'clip', clipIds: ['clip'], originals: { clip: original } }, -25, 'right') as {
			durationFrames: number; sourceStartFrame: number; sourceDurationFrames: number; opaqueExtensions: Record<string, unknown>;
		} | null;
		assert.ok(preview);
		const projected = { ...clip, ...preview };
		assert.equal(projected.durationFrames, 25);
		assert.equal(projected.sourceStartFrame, 70);
		assert.equal(projected.sourceDurationFrames, 50);
		assert.equal(readClipLoop(projected), null);
		assert.equal(projected.opaqueExtensions.other, 'kept');
		const committedDocument = applySoundscaperProjectCommand(projectFixture(clip), { type: 'clip/trim', clipId: 'clip', durationFrames: 25 });
		const committed = resolveRuntimeProjectProjection(committedDocument).clips[0]!;
		assert.ok(committed.kind === 'audio');
		assert.deepEqual(projectUnwarpedClipSourceRange(projected, 0, 25), projectUnwarpedClipSourceRange(committed, 0, 25));
	}
});

test('moving and stretching a legacy single-pass clip normalize its phase before transforming', () => {
	const document = projectFixture(legacyLoop(50, 25));
	const moved = applySoundscaperProjectCommand(document, { type: 'clip/transform-many', transforms: [{ clipId: 'clip', trackId: 'track', changes: { timelineStartFrame: 0 } }] });
	assert.equal(moved.clips[0]!.sourceStartFrame, 70);
	assert.equal(moved.clips[0]!.sourceDurationFrames, 100);
	assert.equal(readClipLoop(moved.clips[0]!), null);
	const stretched = applySoundscaperProjectCommand(document, { type: 'clip/transform-many', transforms: [{ clipId: 'clip', trackId: 'track', changes: { durationFrames: 100 } }] });
	assert.equal(stretched.clips[0]!.durationFrames, 100);
	assert.equal(stretched.clips[0]!.sourceDurationFrames, 100);
	assert.equal(readClipLoop(stretched.clips[0]!), null);
});

test('split segments confined to one pass trim normally while crossing segments keep their repetition phase', () => {
	const document = projectFixture(looped);
	const split = applySoundscaperProjectCommand(document, { type: 'clip/split', clipId: 'clip', atFrame: 150, rightClipId: 'right' });
	assert.equal(split.clips[0]!.durationFrames, 50);
	assert.equal(split.clips[0]!.sourceDurationFrames, 100);
	assert.equal(readClipLoop(split.clips[0]!), null);
	assert.deepEqual(readClipLoop(split.clips[1]!), { periodFrames: 100, offsetFrames: 50 });
	const trimmed = applySoundscaperProjectCommand(split, { type: 'clip/trim', clipId: 'clip', durationFrames: 25 });
	assert.equal(trimmed.clips[0]!.sourceDurationFrames, 50);
	assert.equal(readClipLoop(trimmed.clips[0]!), null);
});
