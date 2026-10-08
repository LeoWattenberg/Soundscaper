/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLegacyRecordingCaptureService } from '../src/common/editor/controller/recording/internal/legacy-recording-capture-service.ts';
import { createRoutedRecordingCaptureService } from '../src/common/editor/controller/recording/internal/routed-recording-capture-service.ts';
import { createRecordingCaptureFixture, createScope } from './fixtures/recording-capture-fixture.ts';
import { recordingSourceAlignment } from '../src/common/editor/controller/recording/internal/recording-source-alignment.ts';

test('recording alignment combines the device clock with signed manual compensation', () => {
	for (const sampleRate of [24_000, 44_100, 48_000]) {
		const input = { sampleRate, requestedStartFrame: sampleRate, automaticLatencySeconds: 0.01,
			manualOffsetMs: -110, selection: null };
		const result = recordingSourceAlignment(input);
		assert.equal(result.recordingStartFrame, sampleRate + sampleRate / 10);
		assert.equal(result.sourceOffsetProjectFrames, 0);
		assert.equal(result.latencyFrames, -sampleRate / 10);
		assert.deepEqual(input, { sampleRate, requestedStartFrame: sampleRate, automaticLatencySeconds: 0.01,
			manualOffsetMs: -110, selection: null });
		assert.equal(Object.isFrozen(result), true);
	}
});

test('a signed punch is bounded before capture when its offset exceeds the selection', () => {
	assert.throws(() => recordingSourceAlignment({ sampleRate: 48_000, requestedStartFrame: 0,
		automaticLatencySeconds: 0, manualOffsetMs: -500, selection: { startFrame: 0, endFrame: 24_000 } }),
	/no audio inside the selected range/u);
	const compensated = recordingSourceAlignment({ sampleRate: 48_000, requestedStartFrame: 0,
		automaticLatencySeconds: 0.01, manualOffsetMs: -5, selection: { startFrame: 0, endFrame: 48_000 } });
	assert.equal(compensated.recordingStartFrame, 0);
	assert.equal(compensated.sourceOffsetProjectFrames, 240);
});

for (const routed of [false, true]) {
	const owner = routed ? 'routed' : 'default';
	for (const offset of [-500, -400, 0, 500]) {
		test(`${owner} capture preserves signed ${offset} ms alignment`, async () => {
			const fixture = createRecordingCaptureFixture();
			fixture.state.latencyOffsetMs = offset;
			if (routed) fixture.state.recordingRouting = {
				routes: { 'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 } }, offsets: {},
			};
			const service = routed ? createRoutedRecordingCaptureService(fixture.runtime)
				: createLegacyRecordingCaptureService(fixture.runtime);
			await service.capture({ trackId: 'track-1' }, createScope(() => true));
			const start = routed ? fixture.state.recordingEntries?.[0]?.recordingStartFrame
				: fixture.state.recordingStartFrame;
			const skip = routed ? fixture.state.recordingEntries?.[0]?.sourceOffsetFrames
				: fixture.state.recordingSourceOffsetFrames;
			assert.equal(start, Math.max(0, 100 - offset * 48));
			assert.equal(skip, Math.max(0, offset * 48 - 100));
		});
	}
	for (const offset of [-500, 500]) {
		test(`${owner} signed ${offset} ms punch retains its original end`, async () => {
			const fixture = createRecordingCaptureFixture({ selection: { startFrame: 20, endFrame: 48_020 } });
			fixture.state.latencyOffsetMs = offset;
			if (routed) fixture.state.recordingRouting = {
				routes: { 'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 } }, offsets: {},
			};
			const service = routed ? createRoutedRecordingCaptureService(fixture.runtime)
				: createLegacyRecordingCaptureService(fixture.runtime);
			await service.capture({ trackId: 'track-1' }, createScope(() => true));
			const entry = fixture.state.recordingEntries?.[0];
			const start = routed ? entry?.recordingStartFrame : fixture.state.recordingStartFrame;
			const selection = routed ? entry?.selection : fixture.state.recordingSelection;
			assert.equal(start, offset < 0 ? 24_020 : 20);
			assert.deepEqual(selection, { startFrame: start, endFrame: 48_020 });
			const schedule = fixture.recorderStartOptions[0];
			assert.ok(schedule);
			assert.equal(typeof schedule.startFrame, 'number');
			assert.equal(typeof schedule.stopFrame, 'number');
			assert.ok(schedule.startFrame !== undefined && schedule.stopFrame !== undefined);
			assert.equal(schedule.stopFrame - schedule.startFrame, offset < 0 ? 24_000 : 72_000);
		});
	}
}
