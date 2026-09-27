/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { preparePunchCommand } from '../src/common/editor/commands/range-runtime.js';
import { punchTransitionCutRange } from '../src/common/editor/commands/punch-transition-range.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { automaticClipCrossfadeRanges } from '../src/common/editor/audio-clip-overlap.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject, type AudioEditorProjectCurrent } from '../src/common/editor/project-current.ts';
import { projectForCommand } from '../src/common/editor/project-command-projection.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createLegacyRecordingFinalization } from '../src/common/editor/controller/recording/internal/legacy-recording-finalization.ts';
import { createRoutedRecordingFinalization } from '../src/common/editor/controller/recording/internal/routed-recording-finalization.ts';
import type { RoutedRecordingFinalizationRuntime } from '../src/common/editor/controller/recording/internal/recording-finalization-types.ts';
import type { RecordingFinalizationSnapshot } from '../src/common/editor/controller/recording/internal/recording-session-service.ts';
import type { RecordingSourceWriter } from '../src/common/editor/controller/recording/recording-transaction-types.ts';
import { createCrossfadeOverlays } from '../src/common/editor/ui/timeline/TrackOverlapOverlays.jsx';

const NOW = '2026-09-27T12:00:00.000Z';

function punch(transitionInFrames = 0, transitionOutFrames = 0, originalDurationFrames = 1_000) {
	const originalSource = createAudioSource({
		id: 'original-source', name: 'original.wav', storageKey: 'original-source',
		frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
	});
	const recordedSource = createAudioSource({
		id: 'recorded-source', name: 'recorded.wav', storageKey: 'recorded-source',
		frameCount: 200, channelCount: 1, sampleRate: 48_000,
	});
	const originalClip = createAudioClip({
		id: 'original', sourceId: originalSource.id, timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: originalDurationFrames, durationFrames: originalDurationFrames,
	});
	const project = createCurrentAudioEditorProject({
		id: 'recording-crossfade', now: NOW,
		sources: [originalSource, recordedSource], clips: [originalClip],
		tracks: [createAudioTrack({ id: 'track', name: 'Voice', clipIds: [originalClip.id] })],
	});
	const command = preparePunchCommand(projectForCommand(project as unknown as Record<string, unknown>), {
		trackId: 'track', startFrame: 400, endFrame: 600,
		sourceId: recordedSource.id, clipId: 'recorded',
		transitionInFrames, transitionOutFrames,
	}, () => 'original-right');
	const edited = resolveRuntimeProjectProjection(
		applyEditorCommand(project, command as AudioEditorCommand, { now: NOW }) as AudioEditorProjectCurrent,
	);
	const clips = edited.clips.slice().sort((left, right) => (
		left.timelineStartFrame - right.timelineStartFrame
	));
	return { clips, ranges: automaticClipCrossfadeRanges(clips, {
		id: (clip) => clip.id,
		startFrame: (clip) => clip.timelineStartFrame,
		durationFrames: (clip) => clip.durationFrames,
	}) };
}

test('sound-activated interior punch keeps both old clip tails for automatic crossfades', () => {
	const { clips, ranges } = punch(50, 50);
	assert.deepEqual(clips.map((clip) => [clip.id, clip.timelineStartFrame, clip.durationFrames]), [
		['original', 0, 450],
		['recorded', 400, 200],
		['original-right', 550, 450],
	]);
	assert.deepEqual(ranges.get('original')?.crossfadeOutRanges, [[400, 450]]);
	assert.deepEqual(ranges.get('recorded'), {
		crossfadeInRanges: [[0, 50]], crossfadeOutRanges: [[150, 200]],
	});
	assert.deepEqual(ranges.get('original-right')?.crossfadeInRanges, [[0, 50]]);
});

test('ordinary punch still replaces the exact range', () => {
	const { clips, ranges } = punch();
	assert.deepEqual(clips.map((clip) => [clip.id, clip.timelineStartFrame, clip.durationFrames]), [
		['original', 0, 400],
		['recorded', 400, 200],
		['original-right', 600, 400],
	]);
	assert.deepEqual(ranges.get('recorded'), { crossfadeInRanges: [], crossfadeOutRanges: [] });
});

test('a recording beginning at the existing clip end does not create an artificial crossfade', () => {
	const { clips, ranges } = punch(50, 50, 400);
	assert.deepEqual(clips.map((clip) => [clip.id, clip.timelineStartFrame, clip.durationFrames]), [
		['original', 0, 400], ['recorded', 400, 200],
	]);
	assert.deepEqual(ranges.get('recorded'), { crossfadeInRanges: [], crossfadeOutRanges: [] });
});

test('very short punches retain a nonempty replacement range and reject malformed transitions', () => {
	const range = { startFrame: 400, endFrame: 403 };
	const clips = [{ timelineStartFrame: 0, durationFrames: 1_000 }];
	assert.deepEqual(punchTransitionCutRange(range, clips, {
		transitionInFrames: 2_400, transitionOutFrames: 2_400,
	}), { startFrame: 401, endFrame: 402, durationFrames: 1 });
	assert.throws(() => punchTransitionCutRange(range, clips, {
		transitionInFrames: -1,
	}), /nonnegative safe integer/u);
});

for (const timelineMode of ['compacted', 'continuous'] as const) for (const path of ['legacy', 'routed'] as const) test(`finalizing a ${timelineMode} ${path} take inside an existing clip creates two visible crossfades`, async () => {
	const originalSource = createAudioSource({
		id: 'original-source', name: 'original.wav', storageKey: 'original-source',
		frameCount: 100_000, channelCount: 1, sampleRate: 48_000,
	});
	const originalClip = createAudioClip({
		id: 'original', sourceId: originalSource.id, timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: 100_000, durationFrames: 100_000,
	});
	const project = createCurrentAudioEditorProject({
		id: 'recording-finalization-crossfade', now: NOW,
		sources: [originalSource], clips: [originalClip],
		tracks: [createAudioTrack({ id: 'track', name: 'Voice', clipIds: [originalClip.id] })],
	});
	const writer: RecordingSourceWriter = {
		framesWritten: 20_000,
		async write() {},
		async commit() { return { name: 'recorded.wav', channelCount: 1 }; },
		async abort() {},
	};
	const committed: { project?: AudioEditorProjectCurrent } = {};
	let nextId = 0;
	const runtime: RoutedRecordingFinalizationRuntime = {
		sourceChunkFrames: 65_536,
		captureProjectScope: () => ({ project, projectId: project.id, assertCurrent() {} }),
		projectSampleRate: () => 48_000,
		pauseTransport() {}, setTransportPosition() {},
		async disposeRecorder() {}, appendPreview() {},
		scaleFrames: (frames) => frames,
		createStableId: () => `recorded-${++nextId}`,
		createAddSourceCommand: (source) => ({ type: 'source/add', source }),
		preparePunchCommand: (_sourceProject, options) => preparePunchCommand(
			projectForCommand(project), options, () => `split-${++nextId}`,
		),
		preparePunchSequence: () => { throw new Error('The single take must use one punch.'); },
		async activateStoredSource() {},
		commitBatch: (_sourceProject, commands) => {
			committed.project = applyEditorCommand(project, { type: 'batch', commands } as AudioEditorCommand,
				{ now: NOW }) as AudioEditorProjectCurrent;
		},
		setStatusDone() {}, deactivateSource() {}, async deleteStoredSource() {},
		async deleteSourceAnalysis() {}, setRouteHealth() {},
	};
	const preview = {
		trackId: 'track', startFrame: 40_000, timelineMode,
		framesToSkip: 0, frames: 0, framesPerBucket: 64, bucketFrames: 0,
		minimums: [1], maximums: [-1], buckets: [[]],
	};
	const snapshot: RecordingFinalizationSnapshot = {
		recorder: { stop: async () => {} }, kind: timelineMode === 'compacted' ? 'sound-activated' : 'ordinary', entries: null,
		writer, sourceId: 'recording-source', trackId: 'track', startFrame: 40_000,
		sourceOffsetFrames: 0, selection: null, resampler: null,
		sampleRate: 48_000, preview, discardRequested: false, fatalError: null,
	};
	if (path === 'legacy') await createLegacyRecordingFinalization(runtime).finalize(snapshot);
	else await createRoutedRecordingFinalization(runtime).finalize({ ...snapshot, entries: [{
		trackId: 'track', sourceKey: 'device:mic', sourceId: 'recording-source', writer,
		route: { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
		preview, previewResampler: { push: (channels: readonly Float32Array[]) => channels, finish: () => [] },
		sampleRate: 48_000, selection: null, recordingStartFrame: 40_000,
		sourceOffsetFrames: 0, sourceOffsetProjectFrames: 0,
	}] });
	assert.ok(committed.project);
	const resolved = resolveRuntimeProjectProjection(committed.project);
	const clips = resolved.clips.slice().sort((left, right) => (
		left.timelineStartFrame - right.timelineStartFrame
	));
	assert.deepEqual(clips.map((clip) => [clip.timelineStartFrame, clip.timelineEndFrame]), [
		[0, 42_400], [40_000, 60_000], [57_600, 100_000],
	]);
	const overlays = createCrossfadeOverlays(clips.map((clip) => ({
		...clip, isVisible: true,
	})), 0, 100, 48_000);
	assert.deepEqual(overlays.map(({ startFrame, endFrame }: { startFrame: number; endFrame: number }) => (
		[startFrame, endFrame]
	)), [[40_000, 42_400], [57_600, 60_000]]);
});
