/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createLegacyRecordingCaptureService } from '../src/common/editor/controller/legacy-recording-capture-service.ts';
import type { RecordingMediaStream } from '../src/common/editor/controller/recording-transaction-types.ts';
import {
	createRecordingCaptureFixture,
	createScope,
	deferred,
} from './fixtures/recording-capture-fixture.ts';

test('legacy capture checks ownership after input acquisition and suppresses stale publication', async () => {
	const acquisition = deferred<RecordingMediaStream>();
	const fixture = createRecordingCaptureFixture({ acquireHardware: () => acquisition.promise });
	let current = true;
	const operation = createLegacyRecordingCaptureService(fixture.runtime).capture(
		{ trackId: 'track-1' },
		createScope(() => current),
	);
	assert.equal(fixture.publishes(), 1);
	current = false;
	acquisition.resolve(fixture.stream);
	await operation;

	assert.equal(fixture.recorderCreations(), 0);
	assert.equal(fixture.publishes(), 1);
	assert.equal(fixture.releases(), 1);
});

test('legacy capture publishes one initialized take and releases its start guard', async () => {
	const fixture = createRecordingCaptureFixture();
	await createLegacyRecordingCaptureService(fixture.runtime).capture(
		{ trackId: 'track-1' },
		createScope(() => true),
	);

	assert.equal(fixture.recorderCreations(), 1);
	assert.equal(fixture.state.recordingStarting, false);
	assert.equal(fixture.state.recordingTrackId, 'track-1');
	assert.equal(fixture.state.recordingSourceId, 'source-1');
	assert.strictEqual(fixture.state.recordingStream, fixture.stream);
	assert.ok(fixture.state.recorder);
	assert.ok(fixture.recorderOptions());
	assert.equal(fixture.publishes(), 2);
	const recorderOptions = fixture.recorderOptions();
	assert.ok(recorderOptions);
	await recorderOptions.onChunk({
		frameStart: 0,
		frames: 2,
		channels: [Float32Array.from([0.5, -0.25])],
	});
	assert.ok(fixture.state.inputMeterDb > -7 && fixture.state.inputMeterDb < -5);
	assert.equal(fixture.previewPublishes(), 1);
	const failure = new Error('processor failed');
	recorderOptions.onError(failure);
	assert.strictEqual(fixture.state.recordingFatalError, failure);
	assert.deepEqual(fixture.errors, [failure]);
	assert.equal(fixture.stopCalls(), 1);
	recorderOptions.onState('stopped');
	assert.equal(fixture.finalizeCalls(), 1);
});

test('legacy capture schedules timed starts and cleans up controller creation failures', async () => {
	const timed = createRecordingCaptureFixture();
	await createLegacyRecordingCaptureService(timed.runtime).capture(
		{ trackId: 'track-1', timedStartTimeMs: 2_000 },
		createScope(() => true),
	);
	assert.equal(timed.startCalls(), 1);

	const creationFailure = new Error('controller unavailable');
	const failed = createRecordingCaptureFixture({
		createRecorder: async () => { throw creationFailure; },
	});
	await assert.rejects(
		createLegacyRecordingCaptureService(failed.runtime).capture(
			{ trackId: 'track-1' },
			createScope(() => true),
		),
		creationFailure,
	);
	assert.equal(failed.state.recordingStarting, false);
	assert.equal(failed.state.recorder, null);
	assert.equal(failed.releases(), 1);
});

test('legacy prepared-only capture rejects a missing retained input before requesting permission', async () => {
	const fixture = createRecordingCaptureFixture();
	await assert.rejects(
		createLegacyRecordingCaptureService(fixture.runtime).capture(
			{ trackId: 'track-1', reusePreparedInputsOnly: true },
			createScope(() => true),
		),
		/Prepared input closed/,
	);
	assert.equal(fixture.hardwareRequests(), 0);
	assert.equal(fixture.state.recordingStarting, false);
});

test('legacy capture covers blocked actions, armed-track lookup, and range recording', async () => {
	const blocked = createRecordingCaptureFixture();
	blocked.state.readOnly = true;
	assert.equal(await createLegacyRecordingCaptureService(blocked.runtime).capture(
		{ trackId: 'track-1' },
		createScope(() => true),
	), undefined);
	blocked.state.readOnly = false;
	blocked.state.recordingStarting = true;
	assert.equal(await createLegacyRecordingCaptureService(blocked.runtime).capture(
		{ trackId: 'track-1' },
		createScope(() => true),
	), undefined);
	blocked.state.recordingStarting = false;
	blocked.state.recorder = { stop: async () => {} };
	assert.equal(await createLegacyRecordingCaptureService(blocked.runtime).capture(
		{ trackId: 'track-1' },
		createScope(() => true),
	), undefined);

	const ranged = createRecordingCaptureFixture({ selection: { startFrame: 20, endFrame: 80 } });
	ranged.state.leadInRecording = true;
	await createLegacyRecordingCaptureService(ranged.runtime).capture({}, createScope(() => true));
	assert.deepEqual(ranged.state.recordingSelection, { startFrame: 20, endFrame: 80 });
	assert.equal(ranged.state.recordingStartFrame, 20);
	assert.equal(ranged.startCalls(), 1);

	const missing = createRecordingCaptureFixture();
	await assert.rejects(
		createLegacyRecordingCaptureService(missing.runtime).capture(
			{ trackId: 'missing' },
			createScope(() => true),
		),
		/Arm a track/,
	);
});

test('legacy count-in shares a deferred playback start with the recorder', async () => {
	const fixture = createRecordingCaptureFixture({
		selection: { startFrame: 144_000, endFrame: 192_000 },
		playAt: async () => 4.1,
	});
	fixture.state.leadInRecording = true;
	(fixture.project as { tempoMap: unknown }).tempoMap = {
		mode: 'musical',
		events: [
			{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
			{ id: 'tempo-2', beat: { num: 2, den: 1 }, bpm: { num: 60, den: 1 } },
		],
	};
	(fixture.project as { signatureMap: unknown }).signatureMap = {
		events: [{ id: 'signature-1', bar: 0, numerator: 6, denominator: 8 }],
	};
	await createLegacyRecordingCaptureService(fixture.runtime).capture({}, createScope(() => true));

	assert.deepEqual(fixture.seekCalls, [24_000]);
	assert.equal(fixture.playAtCalls[0]?.[1], 24_000);
	assert.deepEqual(fixture.recorderStartOptions, [{ startFrame: 316_800, stopFrame: 364_800 }]);
});

test('legacy count-in preserves singleton timing for a map-absent project', async () => {
	const fixture = createRecordingCaptureFixture({ selection: { startFrame: 144_000, endFrame: 192_000 } });
	fixture.state.leadInRecording = true;
	delete (fixture.project as { tempoMap?: unknown }).tempoMap;
	delete (fixture.project as { signatureMap?: unknown }).signatureMap;
	(fixture.project as { tempo: unknown }).tempo = {
		bpm: 60,
		timeSignature: { numerator: 3, denominator: 4 },
	};
	await createLegacyRecordingCaptureService(fixture.runtime).capture({}, createScope(() => true));

	assert.deepEqual(fixture.seekCalls, [0]);
});

test('legacy capture rolls back timed-past and playback-start failures after handoff', async () => {
	const past = createRecordingCaptureFixture();
	await assert.rejects(
		createLegacyRecordingCaptureService(past.runtime).capture(
			{ trackId: 'track-1', timedStartTimeMs: 500 },
			createScope(() => true),
		),
		/Past/,
	);
	assert.equal(past.state.recorder, null);
	assert.equal(past.releases(), 1);

	const playbackFailure = new Error('playback failed');
	const playback = createRecordingCaptureFixture({ playAt: async () => { throw playbackFailure; } });
	await assert.rejects(
		createLegacyRecordingCaptureService(playback.runtime).capture(
			{ trackId: 'track-1' },
			createScope(() => true),
		),
		playbackFailure,
	);
	assert.equal(playback.state.recordingCleanup, null);
	assert.equal(playback.state.recorder, null);
});

test('legacy recorder callbacks ignore superseded work and handle silent chunks', async () => {
	const fixture = createRecordingCaptureFixture();
	await createLegacyRecordingCaptureService(fixture.runtime).capture(
		{ trackId: 'track-1' },
		createScope(() => true),
	);
	const recorderOptions = fixture.recorderOptions();
	assert.ok(recorderOptions);
	await recorderOptions.onChunk({ frameStart: 0, frames: 0, channels: [] });
	assert.equal(fixture.state.inputMeterDb, -60);
	fixture.state.recordingStartGeneration += 1;
	recorderOptions.onError(new Error('stale'));
	recorderOptions.onState('stopped');
	assert.deepEqual(fixture.errors, []);
	assert.equal(fixture.stopCalls(), 0);
	assert.equal(fixture.finalizeCalls(), 0);
});
