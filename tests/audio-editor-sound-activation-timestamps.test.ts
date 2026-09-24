/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundActivatedRecordingCaptureSession } from '../src/common/editor/controller/recording/internal/sound-activation/sound-activated-recording-capture-session.ts';
import { createSoundActivationTimestampCommands } from '../src/common/editor/controller/recording/internal/sound-activation/sound-activation-timestamp-labels.ts';
import { createLegacyRecordingFinalization } from '../src/common/editor/controller/recording/internal/legacy-recording-finalization.ts';
import { createRoutedRecordingFinalization } from '../src/common/editor/controller/recording/internal/routed-recording-finalization.ts';
import type { RecordingFinalizationCommonRuntime } from '../src/common/editor/controller/recording/internal/recording-finalization-types.ts';
import type { RecordingFinalizationSnapshot } from '../src/common/editor/controller/recording/internal/recording-session-service.ts';
import type { RecordingPreview } from '../src/common/editor/controller/recording/recording-model.ts';
import type { RoutedRecordingEntry } from '../src/common/editor/controller/recording/recording-transaction-types.ts';

const SOURCE = Object.freeze({ sourceKey: 'device:mic', kind: 'device' as const, sampleRate: 1_000, channelCount: 1 });
const SETTINGS = Object.freeze({ thresholdDb: -20, hysteresisDb: 0, holdFrames: 0 });

test('each activation retains its exact compacted frame across chunks and pauses', () => {
	const session = createSoundActivatedRecordingCaptureSession({
		getSettings: () => SETTINGS,
		getAddTimestamps: () => true,
		setState() {},
	}, SOURCE, () => true);
	const controller = session.wrapController({
		start() {}, pause: () => true, resume: () => true, stop() {},
		setMonitoring() {}, setInputGain() {},
	});
	controller.start();
	session.process({ frameStart: 100, frames: 5, channels: [Float32Array.of(0, 0.5, 0, 0.8, 0.8)] });
	assert.deepEqual(session.activationFrameOffsets, [0, 1]);
	controller.pause();
	controller.resume();
	session.process({ frameStart: 120, frames: 3, channels: [Float32Array.of(0, 0.4, 0)] });
	assert.deepEqual(session.activationFrameOffsets, [0, 1, 3]);
});

test('timestamp commands create one label track and use compacted project positions', () => {
	let index = 0;
	const commands = createSoundActivationTimestampCommands({
		project: { id: 'project', tracks: [{ id: 'audio', type: 'audio' }] },
		labelTrackName: 'Labels',
		projectSampleRate: 1_000,
		createId: (prefix) => `${prefix}-${++index}`,
		timestamps: [
			{ startFrame: 1_000, offsetFrames: 0, sampleRate: 1_000 },
			{ startFrame: 1_000, offsetFrames: 250, sampleRate: 1_000 },
			{ startFrame: 2_000, offsetFrames: 500, sampleRate: 1_000 },
		],
	});
	assert.deepEqual(commands.map((command) => command.type), ['track/add', 'label/add', 'label/add', 'label/add']);
	const labels = commands.slice(1).map((command) => {
		assert.equal(command.type, 'label/add');
		return command.label;
	});
	assert.deepEqual(labels.map(({ startFrame, endFrame, title }) => [startFrame, endFrame, title]), [
		[1_000, 1_000, '00:00:01.000'],
		[1_250, 1_250, '00:00:01.250'],
		[2_500, 2_500, '00:00:02.500'],
	]);
});

test('timestamp commands reuse an existing label track and sort simultaneous source sessions', () => {
	const commands = createSoundActivationTimestampCommands({
		project: { id: 'project', tracks: [
			{ id: 'audio', type: 'audio' },
			{ id: 'existing-labels', type: 'label' },
		] },
		labelTrackName: 'Labels',
		projectSampleRate: 1_000,
		createId: (prefix) => `${prefix}-new`,
		timestamps: [
			{ startFrame: 2_000, offsetFrames: 500, sampleRate: 1_000 },
			{ startFrame: 1_000, offsetFrames: 250, sampleRate: 1_000 },
		],
	});
	assert.deepEqual(commands.map((command) => command.type), ['label/add', 'label/add']);
	assert.deepEqual(commands.map((command) => {
		assert.equal(command.type, 'label/add');
		return [command.trackId, command.label.startFrame];
	}), [['existing-labels', 1_250], ['existing-labels', 2_500]]);
});

function recordingPreview(trackId: string): RecordingPreview {
	return {
		trackId,
		startFrame: 1_000,
		timelineMode: 'compacted',
		activationFrameOffsets: [0, 250],
		framesToSkip: 0,
		frames: 500,
		framesPerBucket: 64,
		bucketFrames: 0,
		minimums: [0],
		maximums: [0],
		buckets: [[]],
	};
}

function recordingWriter() {
	return {
		framesWritten: 500,
		async write() {},
		async commit() { return { name: 'Take', channelCount: 1 }; },
		async abort() {},
	};
}

function finalizationFixture() {
	const project = { id: 'project', tracks: [
		{ id: 'audio-1', type: 'audio' },
		{ id: 'audio-2', type: 'audio' },
	] };
	const commits: Array<Readonly<{ commands: readonly unknown[]; selection: Readonly<Record<string, unknown>> }>> = [];
	let id = 0;
	const runtime: RecordingFinalizationCommonRuntime = {
		sourceChunkFrames: 65_536,
		labelTrackName: 'Markierungen',
		captureProjectScope: () => ({ project, projectId: project.id, assertCurrent() {} }),
		projectSampleRate: () => 1_000,
		pauseTransport() {},
		setTransportPosition() {},
		async disposeRecorder() {},
		appendPreview() {},
		scaleFrames: (frames, inputRate, outputRate) => Math.round(frames * outputRate / inputRate),
		createStableId: (prefix) => `${prefix}-${++id}`,
		createAddSourceCommand: (source) => ({ type: 'source/add', source }),
		preparePunchCommand: (_project, options) => ({ type: 'clip/punch', options }),
		preparePunchSequence: (_project, segments) => segments.flatMap(({ source, punch }) => [
			{ type: 'source/add', source }, { type: 'clip/punch', options: punch },
		]),
		async activateStoredSource() {},
		commitBatch: (_project, commands, selection) => { commits.push({ commands, selection }); },
		setStatusDone() {},
		deactivateSource() {},
		async deleteStoredSource() {},
	};
	return { runtime, commits };
}

function finalizationSnapshot(preview: RecordingPreview): RecordingFinalizationSnapshot {
	return {
		recorder: { stop() {} },
		kind: 'sound-activated',
		entries: null,
		writer: recordingWriter(),
		sourceId: 'source-1',
		trackId: preview.trackId,
		startFrame: 1_000,
		sourceOffsetFrames: 0,
		selection: null,
		resampler: null,
		sampleRate: 1_000,
		preview,
		discardRequested: false,
		fatalError: null,
	};
}

test('legacy finalization commits timestamp labels with the take and discards them with the take', async () => {
	const fixture = finalizationFixture();
	const preview = recordingPreview('audio-1');
	await createLegacyRecordingFinalization(fixture.runtime).finalize(finalizationSnapshot(preview));
	const commands = fixture.commits[0]?.commands as readonly Readonly<Record<string, unknown>>[];
	assert.deepEqual(commands.map((command) => command.type), [
		'source/add', 'clip/punch', 'track/add', 'label/add', 'label/add',
	]);
	assert.equal((commands[2]?.track as Readonly<{ name: string }>).name, 'Markierungen');
	assert.deepEqual(commands.slice(3).map((command) => (
		(command.label as Readonly<{ startFrame: number }>).startFrame
	)), [1_000, 1_250]);
	assert.deepEqual(fixture.commits[0]?.selection, { selectTrackId: 'audio-1', selectClipId: 'clip-1' });

	const discarded = finalizationFixture();
	await createLegacyRecordingFinalization(discarded.runtime).finalize({
		...finalizationSnapshot(preview), discardRequested: true,
	});
	assert.deepEqual(discarded.commits, []);
});

test('a source routed to two tracks creates one label per activation', async () => {
	const fixture = finalizationFixture();
	const sharedOffsets = [0, 250];
	const entries: RoutedRecordingEntry[] = ['audio-1', 'audio-2'].map((trackId, index) => ({
		trackId,
		route: { kind: 'device', deviceId: 'mic', channelStart: index, channelCount: 1 },
		sourceKey: 'device:mic',
		sourceId: `source-${index + 1}`,
		writer: recordingWriter(),
		previewResampler: { push: (channels) => channels, finish: () => [] },
		preview: { ...recordingPreview(trackId), activationFrameOffsets: sharedOffsets },
		sampleRate: 1_000,
		selection: null,
		recordingStartFrame: 1_000,
		sourceOffsetFrames: 0,
		sourceOffsetProjectFrames: 0,
	}));
	await createRoutedRecordingFinalization({
		...fixture.runtime,
		setRouteHealth() {},
		async deleteSourceAnalysis() {},
	}).finalize({ ...finalizationSnapshot(recordingPreview('audio-1')), entries });
	assert.deepEqual(fixture.commits[0]?.commands.map((command) => (
		command as Readonly<{ type: string }>
	).type), [
		'source/add', 'clip/punch', 'source/add', 'clip/punch', 'track/add', 'label/add', 'label/add',
	]);
});
