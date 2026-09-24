/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createRecordingCheckpointWriter } from '../src/common/editor/controller/recording/internal/recording-checkpoint-writer.ts';
import { createRoutedRecordingFinalization } from '../src/common/editor/controller/recording/internal/routed-recording-finalization.ts';
import { createLegacyRecordingFinalization } from '../src/common/editor/controller/recording/internal/legacy-recording-finalization.ts';
import { prepareRecordingPunchSequence } from '../src/common/editor/controller/recording/internal/recording-punch-sequence.js';
import type { RoutedRecordingFinalizationRuntime } from '../src/common/editor/controller/recording/internal/recording-finalization-types.ts';
import type { RecordingFinalizationSnapshot } from '../src/common/editor/controller/recording/internal/recording-session-service.ts';
import type { RecordingSourceWriter, RoutedRecordingEntry } from '../src/common/editor/controller/recording/recording-transaction-types.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';

function storedWriter(sourceId: string, failWrite = false) {
	let framesWritten = 0;
	let committed = false;
	let aborted = false;
	const writer: RecordingSourceWriter = {
		get framesWritten() { return framesWritten; },
		async write(channels) {
			if (failWrite) throw new Error('storage full');
			framesWritten += channels[0]?.length ?? 0;
		},
		async commit() {
			committed = true;
			return { name: sourceId, channelCount: 1 };
		},
		async abort() { aborted = true; },
	};
	return { writer, committed: () => committed, aborted: () => aborted };
}

test('recording checkpoints retain the committed prefix when a later write fails', async () => {
	const first = storedWriter('source-1');
	const second = storedWriter('source-2', true);
	const failed = new Error('storage full');
	const writer = createRecordingCheckpointWriter({
		firstSourceId: 'source-1',
		initialWriter: first.writer,
		metadata: { sampleRate: 48_000, channelCount: 1 },
		checkpointFrames: 4,
		createSourceId: () => 'source-2',
		openWriter: async () => second.writer,
	});
	await writer.write([new Float32Array(4)]);
	assert.equal(first.committed(), true);
	assert.equal(writer.checkpoints?.length, 1);
	await assert.rejects(() => Promise.resolve(writer.write([new Float32Array(4)])), /storage full/iu);
	const recovered = await writer.finishRecording?.();
	assert.deepEqual(recovered?.segments.map(({ sourceId, frameStart, frameCount }) => ({
		sourceId, frameStart, frameCount,
	})), [{ sourceId: 'source-1', frameStart: 0, frameCount: 4 }]);
	assert.equal((recovered?.failure as Error)?.message, failed.message);
	assert.equal(first.aborted(), false);
	assert.equal(second.aborted(), true);
});

test('recording finalization commits the tail after a capture error', async () => {
	const first = storedWriter('source-1');
	const second = storedWriter('source-2');
	const writer = createRecordingCheckpointWriter({
		firstSourceId: 'source-1', initialWriter: first.writer,
		metadata: { sampleRate: 48_000, channelCount: 1 }, checkpointFrames: 4,
		createSourceId: () => 'source-2', openWriter: async () => second.writer,
	});
	await writer.write([new Float32Array(4)]);
	await writer.write([new Float32Array(3)]);
	const recovered = await writer.finishRecording?.();
	assert.equal(second.committed(), true);
	assert.deepEqual(recovered?.segments.map(({ frameStart, frameCount }) => ({ frameStart, frameCount })), [
		{ frameStart: 0, frameCount: 4 }, { frameStart: 4, frameCount: 3 },
	]);
});

function routedFixture(writer: RecordingSourceWriter) {
	const project = { id: 'project-1', tracks: [{ id: 'track-1', type: 'audio' }] };
	const commits: unknown[][] = [];
	const deleted: string[] = [];
	const entry: RoutedRecordingEntry = {
		trackId: 'track-1', sourceKey: 'device:mic', sourceId: 'source-1', writer,
		route: { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
		preview: { trackId: 'track-1', startFrame: 10, timelineMode: 'continuous',
			framesToSkip: 0, frames: 0, framesPerBucket: 64, bucketFrames: 0,
			minimums: [1], maximums: [-1], buckets: [[]] },
		previewResampler: { push: (channels) => channels, finish: () => [] },
		sampleRate: 48_000, selection: null, recordingStartFrame: 10,
		sourceOffsetFrames: 0, sourceOffsetProjectFrames: 0,
	};
	let clipId = 0;
	const runtime: RoutedRecordingFinalizationRuntime = {
		sourceChunkFrames: 65_536,
		captureProjectScope: () => ({ project, projectId: project.id, assertCurrent() {} }),
		projectSampleRate: () => 48_000,
		pauseTransport() {}, setTransportPosition() {},
		disposeRecorder: async () => {}, appendPreview() {},
		scaleFrames: (frames) => frames,
		createStableId: () => `clip-${++clipId}`,
		createAddSourceCommand: (source) => ({ type: 'source/add', source }),
		preparePunchCommand: (_project, options) => ({ type: 'punch/replace', options }),
		preparePunchSequence: (_project, segments) => segments.flatMap(({ source, punch }) => [
			{ type: 'source/add', source }, { type: 'punch/replace', options: punch },
		]),
		activateStoredSource: async () => {},
		commitBatch: (_project, commands) => { commits.push([...commands]); },
		setStatusDone() {}, deactivateSource() {},
		deleteStoredSource: async (id) => { deleted.push(id); },
		deleteSourceAnalysis: async () => {}, setRouteHealth() {},
	};
	const snapshot: RecordingFinalizationSnapshot = {
		recorder: { stop: async () => {} }, kind: 'ordinary', entries: [entry],
		writer: null, sourceId: null, trackId: null, startFrame: 10,
		sourceOffsetFrames: 0, selection: null, resampler: null,
		sampleRate: 48_000, preview: null, discardRequested: false, fatalError: null,
	};
	return { runtime, snapshot, entry, commits, deleted };
}

test('routed finalization publishes saved checkpoints after a later storage failure', async () => {
	const first = storedWriter('source-1');
	const second = storedWriter('source-2', true);
	const writer = createRecordingCheckpointWriter({
		firstSourceId: 'source-1', initialWriter: first.writer,
		metadata: { sampleRate: 48_000, channelCount: 1 }, checkpointFrames: 4,
		createSourceId: () => 'source-2', openWriter: async () => second.writer,
	});
	await writer.write([new Float32Array(4)]);
	await assert.rejects(() => Promise.resolve(writer.write([new Float32Array(4)])), /storage full/iu);
	const fixture = routedFixture(writer);
	await assert.rejects(createRoutedRecordingFinalization(fixture.runtime).finalize({
		...fixture.snapshot, entries: [fixture.entry], fatalError: new Error('storage full'),
	}), /storage full/iu);
	assert.deepEqual(fixture.deleted, []);
	assert.equal(fixture.commits.length, 1);
	const punch = fixture.commits[0]?.[1] as { options: { sourceId: string; startFrame: number; endFrame: number } };
	assert.deepEqual(punch.options, {
		trackId: 'track-1', startFrame: 10, endFrame: 14,
		sourceId: 'source-1', sourceStartFrame: 0, sourceDurationFrames: 4, clipId: 'clip-1',
	});
});

test('routed finalization keeps a checkpoint when recorder disposal rejects', async () => {
	const first = storedWriter('source-1');
	const writer = createRecordingCheckpointWriter({
		firstSourceId: 'source-1', initialWriter: first.writer,
		metadata: { sampleRate: 48_000, channelCount: 1 }, checkpointFrames: 4,
		createSourceId: () => 'source-2', openWriter: async () => storedWriter('source-2').writer,
	});
	await writer.write([new Float32Array(4)]);
	const fixture = routedFixture(writer);
	const failed = new Error('worklet stopped unexpectedly');
	await assert.rejects(createRoutedRecordingFinalization({
		...fixture.runtime, disposeRecorder: async () => { throw failed; },
	}).finalize({ ...fixture.snapshot, entries: [fixture.entry] }), failed);
	assert.equal(fixture.commits.length, 1);
	assert.deepEqual(fixture.deleted, []);
});

test('routed finalization places consecutive checkpoints without a gap', async () => {
	const first = storedWriter('source-1');
	const second = storedWriter('source-2');
	const writer = createRecordingCheckpointWriter({
		firstSourceId: 'source-1', initialWriter: first.writer,
		metadata: { sampleRate: 48_000, channelCount: 1 }, checkpointFrames: 4,
		createSourceId: () => 'source-2', openWriter: async () => second.writer,
	});
	await writer.write([new Float32Array(4)]);
	await writer.write([new Float32Array(3)]);
	const fixture = routedFixture(writer);
	await createRoutedRecordingFinalization(fixture.runtime).finalize({
		...fixture.snapshot, entries: [fixture.entry],
	});
	const punches = fixture.commits[0]?.filter((command) => (
		(command as { type: string }).type === 'punch/replace'
	)) as Array<{ options: { sourceId: string; startFrame: number; endFrame: number } }>;
	assert.deepEqual(punches.map(({ options }) => [options.sourceId, options.startFrame, options.endFrame]), [
		['source-1', 10, 14], ['source-2', 14, 17],
	]);
});

test('legacy finalization places consecutive checkpoints without a gap', async () => {
	const first = storedWriter('source-1');
	const second = storedWriter('source-2');
	const writer = createRecordingCheckpointWriter({
		firstSourceId: 'source-1', initialWriter: first.writer,
		metadata: { sampleRate: 48_000, channelCount: 1 }, checkpointFrames: 4,
		createSourceId: () => 'source-2', openWriter: async () => second.writer,
	});
	await writer.write([new Float32Array(4)]);
	await writer.write([new Float32Array(3)]);
	const fixture = routedFixture(writer);
	await createLegacyRecordingFinalization(fixture.runtime).finalize({
		...fixture.snapshot, entries: null, writer,
		sourceId: 'source-1', trackId: 'track-1',
		resampler: fixture.entry.previewResampler, preview: fixture.entry.preview,
	});
	const punches = fixture.commits[0]?.filter((command) => (
		(command as { type: string }).type === 'punch/replace'
	)) as Array<{ options: { sourceId: string; startFrame: number; endFrame: number } }>;
	assert.deepEqual(punches.map(({ options }) => [options.sourceId, options.startFrame, options.endFrame]), [
		['source-1', 10, 14], ['source-2', 14, 17],
	]);
});

test('legacy finalization refuses a checkpoint punch after project ownership changes during preparation', async () => {
	const first = storedWriter('source-1');
	const second = storedWriter('source-2');
	const writer = createRecordingCheckpointWriter({
		firstSourceId: 'source-1', initialWriter: first.writer,
		metadata: { sampleRate: 48_000, channelCount: 1 }, checkpointFrames: 4,
		createSourceId: () => 'source-2', openWriter: async () => second.writer,
	});
	await writer.write([new Float32Array(4)]);
	await writer.write([new Float32Array(3)]);
	const fixture = routedFixture(writer);
	const project = fixture.runtime.captureProjectScope().project;
	let current = true;
	let preparationStarted: () => void = () => undefined;
	let finishPreparation: (commands: readonly unknown[]) => void = () => undefined;
	const started = new Promise<void>((resolve) => { preparationStarted = resolve; });
	const preparing = new Promise<readonly unknown[]>((resolve) => { finishPreparation = resolve; });
	const finalization = createLegacyRecordingFinalization({
		...fixture.runtime,
		captureProjectScope: () => ({
			project, projectId: project.id,
			assertCurrent() { if (!current) throw new DOMException('Project changed.', 'AbortError'); },
		}),
		preparePunchSequence: () => { preparationStarted(); return preparing; },
	}).finalize({
		...fixture.snapshot, entries: null, writer,
		sourceId: 'source-1', trackId: 'track-1',
		resampler: fixture.entry.previewResampler, preview: fixture.entry.preview,
	});
	await started;
	current = false;
	finishPreparation([]);
	await assert.rejects(finalization, (error: unknown) => (error as DOMException).name === 'AbortError');
	assert.deepEqual(fixture.commits, []);
	assert.deepEqual(fixture.deleted, ['source-1', 'source-2']);
});

test('routed finalization stops before later entries after project ownership changes during preparation', async () => {
	const first = storedWriter('source-1');
	const second = storedWriter('source-2');
	const writer = createRecordingCheckpointWriter({
		firstSourceId: 'source-1', initialWriter: first.writer,
		metadata: { sampleRate: 48_000, channelCount: 1 }, checkpointFrames: 4,
		createSourceId: () => 'source-2', openWriter: async () => second.writer,
	});
	await writer.write([new Float32Array(4)]);
	await writer.write([new Float32Array(3)]);
	const fixture = routedFixture(writer);
	const project = fixture.runtime.captureProjectScope().project;
	let current = true;
	let laterFrameReads = 0;
	const laterWriter: RecordingSourceWriter = {
		get framesWritten() { laterFrameReads += 1; return 0; },
		async write() {}, async commit() { return {}; }, async abort() {},
	};
	const laterEntry: RoutedRecordingEntry = {
		...fixture.entry, trackId: 'track-2', sourceId: 'source-3', writer: laterWriter,
	};
	let preparationStarted: () => void = () => undefined;
	let finishPreparation: (commands: readonly unknown[]) => void = () => undefined;
	const started = new Promise<void>((resolve) => { preparationStarted = resolve; });
	const preparing = new Promise<readonly unknown[]>((resolve) => { finishPreparation = resolve; });
	const routeHealth: string[] = [];
	const finalization = createRoutedRecordingFinalization({
		...fixture.runtime,
		captureProjectScope: () => ({
			project, projectId: project.id,
			assertCurrent() { if (!current) throw new DOMException('Project changed.', 'AbortError'); },
		}),
		preparePunchSequence: () => { preparationStarted(); return preparing; },
		setRouteHealth: (trackId) => { routeHealth.push(trackId); },
	}).finalize({ ...fixture.snapshot, entries: [fixture.entry, laterEntry] });
	await started;
	const readsBeforeInvalidation = laterFrameReads;
	current = false;
	finishPreparation([]);
	await assert.rejects(finalization, (error: unknown) => (error as DOMException).name === 'AbortError');
	assert.equal(laterFrameReads, readsBeforeInvalidation);
	assert.deepEqual(routeHealth, []);
	assert.deepEqual(fixture.commits, []);
});

test('published recording sources survive a later status error', async () => {
	const first = storedWriter('source-1');
	await first.writer.write([new Float32Array(4)]);
	const fixture = routedFixture(first.writer);
	await assert.rejects(createRoutedRecordingFinalization({
		...fixture.runtime, setStatusDone() { throw new Error('status failed'); },
	}).finalize({ ...fixture.snapshot, entries: [fixture.entry] }), /status failed/iu);
	assert.equal(fixture.commits.length, 1);
	assert.deepEqual(fixture.deleted, []);
});

test('successive punch commands preserve the untouched right side of an existing clip', () => {
	const originalSource = createAudioSource({ id: 'original', frameCount: 100, channelCount: 1 });
	const originalClip = createAudioClip({
		id: 'original-clip', sourceId: 'original', timelineStartFrame: 0,
		durationFrames: 100, sourceDurationFrames: 100,
	});
	const project = createAudioEditorProjectV17({
		id: 'checkpoint-punch', now: '2026-09-24T00:00:00.000Z',
		sources: [originalSource], clips: [originalClip],
		tracks: [createAudioTrack({ id: 'track-1', name: 'Track', clipIds: ['original-clip'] })],
		sequences: [{ id: 'sequence', trackIds: ['track-1'] }], primarySequenceId: 'sequence',
	});
	const segments = [
		{ source: createAudioSource({ id: 'source-1', frameCount: 4, channelCount: 1 }),
			punch: { trackId: 'track-1', startFrame: 10, endFrame: 14, sourceId: 'source-1',
				sourceStartFrame: 0, sourceDurationFrames: 4, clipId: 'recorded-1' } },
		{ source: createAudioSource({ id: 'source-2', frameCount: 3, channelCount: 1 }),
			punch: { trackId: 'track-1', startFrame: 14, endFrame: 17, sourceId: 'source-2',
				sourceStartFrame: 0, sourceDurationFrames: 3, clipId: 'recorded-2' } },
	];
	const commands = prepareRecordingPunchSequence(project, segments);
	const result = applyEditorCommand(project, {
		type: 'batch', commands: commands as unknown as AudioEditorCommand[],
	});
	assert.deepEqual(result.clips.map(({ sourceId, timelineStartFrame, durationFrames }) => [
		sourceId, timelineStartFrame, durationFrames,
	]).sort((a, b) => Number(a[1]) - Number(b[1])), [
		['original', 0, 10], ['source-1', 10, 4], ['source-2', 14, 3], ['original', 17, 83],
	]);
});
