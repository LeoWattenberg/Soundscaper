/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { clipLoopUpdateFields, readClipLoop, trimClipLoopPeriod, clipLoopBoundaries } from '../src/common/editor/audio-clip-loop.ts';
import { projectUnwarpedClipSourceRange } from '../src/common/editor/audio-clip-source-projection.ts';
import { prepareBoundedWaveformWindow } from '../src/common/editor/design-system-adapters/waveform.ts';
import { buildClipSchedulePlans } from '../src/common/editor/engine/clip-schedule-plan.ts';
import { createBoundarySnapIndex, resolveBoundarySnap } from '../src/common/editor/ui/timeline/boundary-snap.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { resolveRuntimeClipProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createSpectrogramSampleViews } from '../src/common/editor/ui/timeline/spectrogram-sample-view.ts';
import { clipStretchPointerPreview, loopPointerPreview, sameLoopPointerClip } from '../src/common/editor/ui/timeline/clip-loop-pointer.ts';
import { createTimelineClipViewModel } from '../src/common/editor/ui/timeline/waveform-view-model.ts';

const original = { id: 'clip', kind: 'audio', anchor: 'sample', timelineStartFrame: 100, durationFrames: 100,
	sourceId: 'source', sourceStartFrame: 20, sourceDurationFrames: 200, reversed: false, opaqueExtensions: { other: 'kept' } };
const looped = { ...original, ...clipLoopUpdateFields(original, { periodFrames: 100, durationFrames: 350 }) };

test('looping separates the repetition period from the overall clip and survives JSON persistence', () => {
	assert.equal(looped.durationFrames, 350);
	assert.equal(looped.sourceDurationFrames, 200);
	assert.deepEqual(readClipLoop(JSON.parse(JSON.stringify(looped)) as typeof looped), { periodFrames: 100, offsetFrames: 0 });
	assert.equal(looped.opaqueExtensions.other, 'kept');
	assert.deepEqual(clipLoopBoundaries(looped, 150, 430), [200, 300, 400]);
	assert.equal(readClipLoop({ ...looped, ...clipLoopUpdateFields(looped, false) }), null);
	assert.throws(() => clipLoopUpdateFields(original, { periodFrames: 0 }), /period/);
	assert.throws(() => clipLoopUpdateFields({ ...original, kind: 'video' }, true), /audio/);
});

test('trim handles edit the loop source range and period without moving or resizing the clip', () => {
	const right = trimClipLoopPeriod(looped, 1000, 'right', -25);
	assert.equal(right.periodFrames, 75);
	assert.equal(right.sourceDurationFrames, 150);
	const updated = { ...looped, ...clipLoopUpdateFields(looped, right) };
	assert.equal(updated.durationFrames, 350);
	assert.equal(updated.timelineStartFrame, 100);
	const left = trimClipLoopPeriod(looped, 1000, 'left', 25);
	assert.equal(left.sourceStartFrame, 70);
	assert.equal(left.periodFrames, 75);
	const reverse = trimClipLoopPeriod({ ...looped, reversed: true }, 1000, 'right', -25);
	assert.equal(reverse.sourceStartFrame, 70);
	assert.equal(trimClipLoopPeriod(looped, 220, 'right', 100).periodFrames, 100);
});

test('every full repetition snaps selections and other clips, including a partial final repetition', () => {
	const project = { clips: [looped], tracks: [{ id: 'track', clipIds: ['clip'] }] };
	const index = createBoundarySnapIndex(project);
	assert.deepEqual(resolveBoundarySnap({ project, index, frame: 301, currentTrackId: 'track', pixelsPerSecond: 100, sampleRate: 100 }), { frame: 300, snapped: true });
	assert.equal(resolveBoundarySnap({ project, index, frame: 311, currentTrackId: 'track', pixelsPerSecond: 100, sampleRate: 100 }).snapped, false);
});

test('playback and offline render plans repeat at the original speed and seek into the correct phase', () => {
	const buffer = { sampleRate: 100, length: 1000, getChannelData: () => new Float32Array(1000) } as unknown as AudioBuffer;
	const plans = buildClipSchedulePlans({ project: { clips: [looped], tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }] }, sources: new Map([['source', buffer]]),
		trackInputs: new Map([['track', {} as AudioNode]]), fromFrame: 225, toFrame: 450, sampleRate: 100 });
	assert.deepEqual(plans.map(plan => [plan.segmentStart, plan.segmentEnd, plan.offsetFrame, plan.playbackRate, plan.relativeStart, plan.duration]),
		[[225,450,70,2,125,350]]);
	assert.equal(plans[0]?.loopSourceStartFrame, 20);
	assert.equal(plans[0]?.loopSourceEndFrame, 220);
});

test('waveforms and source windows repeat the actual content instead of stretching it', () => {
	const model = createTimelineClipViewModel({ controller: { getClipVisualData: () => null }, sourceLookup: new Map([['source', { sampleRate: 100 }]]),
		clip: { ...looped, waveformStartFrame: 0, waveformEndFrame: 350 }, geometry: { overscanStartFrame: 0, pixelsPerSecond: 100, sampleRate: 100 },
		selection: { selectedClipIds: null }, copy: { clip: 'Clip' }, rendering: {} });
	assert.equal(model.stretchFactor, 0.5);
	const clip = { sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4, reversed: false };
	const repeated = { ...clip, ...clipLoopUpdateFields({ ...clip, kind: 'audio' }, { periodFrames: 4, durationFrames: 10 }) };
	const waveform = prepareBoundedWaveformWindow([Float32Array.of(0.2, 0.4, -0.2, -0.4)], repeated, { pixelWidth: 100 });
	assert.deepEqual(Array.from(waveform.channels[0]!), Array.from(Float32Array.of(0.2,0.4,-0.2,-0.4,0.2,0.4,-0.2,-0.4,0.2,0.4)));
	assert.deepEqual(projectUnwarpedClipSourceRange(repeated, 5, 7), { startFrame: 1, endFrame: 3 });
	assert.deepEqual(projectUnwarpedClipSourceRange(repeated, 3, 5), { startFrame: 0, endFrame: 4 });
	const views = createSpectrogramSampleViews([Float32Array.of(0.2,0.4,-0.2,-0.4)], { ...repeated, timelineStartFrame: 0, waveformStartFrame: 0, waveformEndFrame: 10 }, {});
	assert.deepEqual(Array.from({ length: 10 }, (_, index) => views[0]!.sampleAt(index)), Array.from(waveform.channels[0]!));
});

test('loop commands persist, split with the correct phase, move, stretch, and replace rendered media', () => {
	const document = createSoundscaperProject({ id: 'loop-project', now: '2026-10-05T12:00:00.000Z',
		sources: [createAudioSource({ id: 'source', storageKey: 'source', sampleRate: 48000, channelCount: 1, frameCount: 1000 }),
			createAudioSource({ id: 'rendered', storageKey: 'rendered', sampleRate: 48000, channelCount: 1, frameCount: 350 })],
		clips: [createAudioClip({ ...original, opaqueExtensions: { ...original.opaqueExtensions, aup4PitchAndSpeedPreset: { preset: 1 } } })], tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })] });
	const enabled = applySoundscaperProjectCommand(document, { type: 'clip/update', clipId: 'clip', changes: { loop: { periodFrames: 100, durationFrames: 350 }, preserveFormants: true } });
	assert.equal(enabled.clips[0]!.durationFrames, 350);
	assert.equal((enabled.clips[0]!.opaqueExtensions as Record<string, unknown>).aup4PitchAndSpeedPreset, undefined);
	assert.equal(document.clips[0]!.durationFrames, 100);
	const split = applySoundscaperProjectCommand(enabled, { type: 'clip/split', clipId: 'clip', atFrame: 225, rightClipId: 'right' });
	const right = resolveRuntimeClipProjection(split, split.clips.find(clip => clip.id === 'right')!);
	assert.equal(readClipLoop(right)?.offsetFrames, 25);
	assert.equal(right.sourceStartFrame, 20);
	assert.equal(right.sourceDurationFrames, 200);
	const moved = applySoundscaperProjectCommand(split, { type: 'clip/transform-many', transforms: [{ clipId: 'right', trackId: 'track', changes: { timelineStartFrame: 0 } }] });
	assert.equal(readClipLoop(moved.clips.find(clip => clip.id === 'right')!)?.offsetFrames, 25);
	const stretched = applySoundscaperProjectCommand(enabled, { type: 'clip/transform-many', transforms: [{ clipId: 'clip', trackId: 'track', changes: { durationFrames: 700, speedRatio: 1, preserveFormants: false } }] });
	assert.equal(readClipLoop(stretched.clips[0]!)?.periodFrames, 200);
	const imported = applySoundscaperProjectCommand(document, { type: 'clip/update', clipId: 'clip', changes: { loop: true } });
	const transformed = applySoundscaperProjectCommand(imported, { type: 'clip/transform-many', transforms: [{ clipId: 'clip', trackId: 'track', changes: { durationFrames: 200, preserveFormants: false } }] });
	assert.equal((transformed.clips[0]!.opaqueExtensions as Record<string, unknown>).aup4PitchAndSpeedPreset, undefined);
	const trimmed = applySoundscaperProjectCommand(enabled, { type: 'clip/trim', clipId: 'clip', sourceRange: true, sourceStartFrame: 20, sourceDurationFrames: 150, durationFrames: 75 });
	assert.equal(trimmed.clips[0]!.durationFrames, 350);
	assert.equal(readClipLoop(trimmed.clips[0]!)?.periodFrames, 75);
	const rendered = applySoundscaperProjectCommand(enabled, { type: 'clip/transform-many', transforms: [{ clipId: 'clip', trackId: 'track', changes: { sourceId: 'rendered', sourceStartFrame: 0, sourceDurationFrames: 350 } }] });
	assert.equal(readClipLoop(rendered.clips[0]!), null);
	assert.equal(rendered.clips[0]!.durationFrames, 350);
});

test('disabling a partial loop preserves its audible range and shrinking retains valid fades and envelopes', () => {
	const partial = { ...looped, ...clipLoopUpdateFields(looped, { periodFrames: 100, offsetFrames: 25, durationFrames: 50 }) };
	const disabled = clipLoopUpdateFields(partial, false);
	assert.equal(disabled.durationFrames, 50);
	assert.equal(disabled.sourceStartFrame, 70);
	assert.equal(disabled.sourceDurationFrames, 100);
	const document = createSoundscaperProject({
		sources: [createAudioSource({ id: 'source', storageKey: 'source', sampleRate: 48000, channelCount: 1, frameCount: 1000 })],
		clips: [createAudioClip({ ...looped, fadeInFrames: 80, fadeOutFrames: 80, envelope: [{ frame: 0, value: 1 }, { frame: 350, value: 0.5 }] })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
	});
	const short = applySoundscaperProjectCommand(document, { type: 'clip/update', clipId: 'clip', changes: { loop: { periodFrames: 100, durationFrames: 50 } } });
	assert.equal(short.clips[0]!.fadeInFrames, 50);
	assert.equal(short.clips[0]!.fadeOutFrames, 50);
	const envelope = short.clips[0]!.envelope as readonly { readonly frame: number }[];
	assert.ok(envelope.every(point => point.frame <= 50));
});

test('streamed repetitions seek correctly even after a split has been moved to frame zero', () => {
	const clip = { ...looped, timelineStartFrame: 0, ...clipLoopUpdateFields(looped, { periodFrames: 100, offsetFrames: 25 }) };
	const chunkSource = { channelCount: 1, sampleRate: 100, frameCount: 1000, chunkFrames: 1000, readStorageChunk: () => ({ channels: [new Float32Array(1000)] }) };
	const plans = buildClipSchedulePlans({ project: { clips: [clip], tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }] }, sources: new Map(), chunkSources: new Map([['source', chunkSource]]),
		trackInputs: new Map([['track', {} as AudioNode]]), fromFrame: 0, toFrame: 175, sampleRate: 100 });
	assert.deepEqual(plans.map(plan => [plan.segmentStart, plan.segmentEnd, plan.offsetFrame]), [[0,75,70], [75,175,20]]);
});

test('the loop pointer snaps full repeats but preserves partial repeats outside the snap tolerance', () => {
	const session = { kind: 'clip-loop', clipId: 'clip', trackId: 'track', startX: 0, original: looped };
	assert.equal(loopPointerPreview(session, 1000, 49, 100, 100)?.durationFrames, 400);
	assert.equal(loopPointerPreview(session, 1000, 40, 100, 100)?.durationFrames, 390);
	assert.equal(loopPointerPreview({ ...session, kind: 'trim-right' }, 1000, -25, 100, 100)?.durationFrames, 350);
	assert.equal(sameLoopPointerClip({ ...looped, sourceId: 'replacement' }, looped), false);
});

test('a selected single-pass clip can start looping and regain ordinary trim behavior at one pass', () => {
	const session = { kind: 'clip-loop', clipId: 'clip', trackId: 'track', startX: 0, original };
	const doubled = loopPointerPreview(session, 1000, 100, 100, 100);
	assert.equal(doubled?.durationFrames, 200);
	assert.deepEqual(readClipLoop(doubled!), { periodFrames: 100, offsetFrames: 0 });
	assert.equal(loopPointerPreview({ ...session, kind: 'trim-right' }, 1000, -25, 100, 100), null);
	const single = loopPointerPreview({ ...session, original: looped }, 1000, -250, 100, 100);
	assert.equal(single?.durationFrames, 100);
	assert.equal(readClipLoop(single!), null);
	assert.equal(loopPointerPreview({ ...session, kind: 'trim-right', original: { ...looped, ...single! } }, 1000, -25, 100, 100), null);
});

test('stretch previews scale the loop period and phase at both handles before commit', () => {
	const repeated = { ...looped, ...clipLoopUpdateFields(looped, { periodFrames: 100, offsetFrames: 25, durationFrames: 400 }) };
	const session = { kind: 'stretch-right', clipId: 'clip', trackId: 'track', startX: 0, original: repeated };
	const right = clipStretchPointerPreview(session, 400, 100, 100);
	assert.equal(right.durationFrames, 800);
	assert.equal(right.timelineStartFrame, 100);
	assert.deepEqual(readClipLoop(right), { periodFrames: 200, offsetFrames: 50 });
	assert.equal(right.waveformPreviewKind, 'rate-stretch');
	const left = clipStretchPointerPreview({ ...session, kind: 'stretch-left' }, -100, 100, 100);
	assert.equal(left.timelineStartFrame, 0);
	assert.equal(left.durationFrames, 500);
	assert.deepEqual(readClipLoop(left), { periodFrames: 125, offsetFrames: 31 });
	const plain = clipStretchPointerPreview({ ...session, original }, 100, 100, 100);
	assert.equal(plain.durationFrames, 200);
	assert.equal(plain.waveformPreviewKind, undefined);
});

test('re-looping a legacy single pass preserves its cropped phase and source speed', () => {
	const legacy = { ...looped, durationFrames: 50, opaqueExtensions: { ...looped.opaqueExtensions, 'org.soundscaper.clip-loop/v1': { periodFrames: 100, offsetFrames: 25 } } };
	const session = { kind: 'clip-loop', clipId: 'clip', trackId: 'track', startX: 0, original: legacy };
	const preview = loopPointerPreview(session, 1000, 50, 100, 100)!;
	assert.equal(preview.durationFrames, 100);
	assert.deepEqual(readClipLoop(preview), { periodFrames: 50, offsetFrames: 0 });
	assert.equal(preview.sourceStartFrame, 70);
	assert.equal(preview.sourceDurationFrames, 100);
	assert.deepEqual(clipLoopUpdateFields(legacy, preview.loopChange), clipLoopUpdateFields({ ...original, durationFrames: 50, sourceStartFrame: 70, sourceDurationFrames: 100 }, preview.loopChange));
	assert.equal(sameLoopPointerClip(legacy, { ...legacy, ...clipLoopUpdateFields(legacy, false) }), true);
});

test('a held stretch gesture renders the same four repetitions as the committed stretch', () => {
	const small = { ...original, timelineStartFrame: 0, durationFrames: 4, sourceStartFrame: 0, sourceDurationFrames: 4 };
	const repeated = { ...small, ...clipLoopUpdateFields(small, { periodFrames: 4, durationFrames: 16 }) };
	const preview = clipStretchPointerPreview({ kind: 'stretch-right', clipId: 'clip', trackId: 'track', startX: 0, original: repeated }, 16, 100, 100);
	const waveform = prepareBoundedWaveformWindow([Float32Array.of(0.1, 0.8, -0.1, -0.8)], { ...repeated, ...preview }, { pixelWidth: 100 });
	assert.deepEqual(clipLoopBoundaries({ ...repeated, ...preview }, 0, 32), [8, 16, 24]);
	const samples = Array.from(waveform.channels[0]!);
	assert.equal(samples.length, 32);
	for (let offset = 8; offset < 32; offset += 8) assert.deepEqual(samples.slice(offset, offset + 8), samples.slice(0, 8));
});

test('legacy single-pass stretch previews override raw project metadata and audible source bounds', () => {
	const legacy = { ...looped, durationFrames: 50, opaqueExtensions: { ...looped.opaqueExtensions, 'org.soundscaper.clip-loop/v1': { periodFrames: 100, offsetFrames: 25 } } };
	const preview = clipStretchPointerPreview({ kind: 'stretch-right', clipId: 'clip', trackId: 'track', startX: 0, original: legacy }, 50, 100, 100);
	const projected = { ...legacy, ...preview };
	assert.equal(projected.durationFrames, 100);
	assert.equal(projected.sourceStartFrame, 70);
	assert.equal(projected.sourceDurationFrames, 100);
	assert.equal(readClipLoop(projected), null);
	assert.equal(preview.waveformPreviewKind, 'rate-stretch');
});

test('selected loop stretches preview every companion and share the left-edge bound used on commit', () => {
	const repeated = { ...looped, durationFrames: 400 };
	const companion = { ...repeated, id: 'companion', timelineStartFrame: 0, durationFrames: 200 };
	const session = { kind: 'stretch-right', clipId: 'clip', clipIds: ['clip', 'companion'], trackId: 'track', startX: 0,
		original: repeated, originals: { clip: repeated, companion } };
	const right = clipStretchPointerPreview(session, 400, 100, 100, id => id === 'clip' ? 'track' : 'other');
	assert.deepEqual(right.previews?.map(preview => [preview.clipId, preview.trackId, preview.durationFrames, readClipLoop(preview)?.periodFrames]),
		[['clip', 'track', 800, 200], ['companion', 'other', 400, 200]]);
	const left = clipStretchPointerPreview({ ...session, kind: 'stretch-left' }, -100, 100, 100);
	assert.equal(left.timelineStartFrame, 100);
	assert.equal(left.durationFrames, 400);
	assert.deepEqual(left.previews?.map(preview => preview.timelineStartFrame), [100, 0]);
});
