/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createViewStateService,
	type ViewStateServiceRuntime,
} from '../src/common/editor/controller/view-state-service.ts';

function createFixture() {
	const meterCalls: boolean[] = [];
	let telemetryPublishes = 0;
	let projectPublishes = 0;
	let microphoneStops = 0;
	let metronomeSynchronizations = 0;
	let blocked = false;
	let sampleEditing = false;
	let contentDurationFrames = 48_000;
	let routedMeterEnabled = false;
	const commands: unknown[] = [];
	let project: { tracks: Array<{ id: string; height?: number }> } = {
		tracks: [{ id: 'track', height: 100 }, { id: 'second', height: 114 }],
	};
	const state = {
		recordingPreviews: [] as Array<{ startFrame: number; frames: number }>,
		recorder: null as object | null,
		positionFrame: 0,
		durationFrames: 0,
		transportState: 'stopped',
		inputLoudnessMeasurementExplicitlyRunning: false,
		inputLoudnessMeasurementManuallyPaused: false,
		microphoneMetering: false,
		meters: null,
		pixelsPerSecond: 100,
		timelineViewportWidth: 1_000,
		sampleEditMode: 'pencil' as string | null,
		autoFitTrackHeight: true,
		visibleTrackHeights: {} as Record<string, number>,
	};
	const runtime: ViewStateServiceRuntime = {
		MAX_PIXELS_PER_SECOND: 48_000,
		MAX_TIMELINE_PIXELS: 1_000_000,
		commit: (command) => { commands.push(command); return project; },
		copy: { trackNotFound: 'Track not found.' },
		editingBlocked: () => blocked,
		editorTimelineDurationFrames: () => 48_000,
		findTrack: (value, id) => value.tracks.find((track: { id: string }) => track.id === id),
		getMicrophoneMeterSession: () => ({
			loudnessMeter: {
				setRunning: (running: boolean) => { meterCalls.push(running); },
				requestSnapshot: () => undefined,
			},
		}),
		getProject: () => project,
		getRoutedInputLoudnessMeter: () => routedMeterEnabled ? {
			setRunning: (running: boolean) => { meterCalls.push(running); },
		} : null,
		projectDurationFrames: () => contentDurationFrames,
		projectSampleRate: () => 48_000,
		publishProjectState: () => { projectPublishes += 1; },
		publishTelemetrySnapshot: () => { telemetryPublishes += 1; },
		sampleEditingAvailable: () => sampleEditing,
		state,
		stopMicrophoneMetering: () => { microphoneStops += 1; },
		syncMetronome: () => { metronomeSynchronizations += 1; },
	};
	return {
		service: createViewStateService(runtime),
		state,
		commands,
		meterCalls,
		telemetryPublishes: () => telemetryPublishes,
		projectPublishes: () => projectPublishes,
		microphoneStops: () => microphoneStops,
		metronomeSynchronizations: () => metronomeSynchronizations,
		setBlocked(value: boolean) { blocked = value; },
		setSampleEditing(value: boolean) { sampleEditing = value; },
		setContentDurationFrames(value: number) { contentDurationFrames = value; },
		setRoutedMeterEnabled(value: boolean) { routedMeterEnabled = value; },
		setProject(value: typeof project) { project = value; },
	};
}

test('recording previews extend playhead and duration in project coordinates', () => {
	const fixture = createFixture();
	assert.equal(Object.isFrozen(fixture.service), true);
	fixture.state.recorder = {};
	fixture.state.recordingPreviews = [{ startFrame: 100, frames: 50 }];
	fixture.service.updatePlayhead(120, 130);
	assert.equal(fixture.state.positionFrame, 150);
	assert.equal(fixture.state.durationFrames, 150);
	assert.equal(fixture.telemetryPublishes(), 1);
});

test('transport state owns loudness-meter running policy', () => {
	const fixture = createFixture();
	fixture.service.updateTransportState('recording');
	fixture.service.updateTransportState('stopped');
	assert.deepEqual(fixture.meterCalls, [true, false]);
	assert.equal(fixture.state.inputLoudnessMeasurementExplicitlyRunning, false);
	assert.equal(fixture.telemetryPublishes(), 2);
});

test('track-height changes commit one atomic batch and disable auto-fit', () => {
	const fixture = createFixture();
	assert.equal(fixture.service.resizeTrackHeight('track', 140), 'track');
	assert.equal(fixture.state.autoFitTrackHeight, false);
	assert.equal(fixture.commands.length, 1);
	assert.deepEqual(fixture.commands[0], {
		type: 'batch',
		commands: [{ type: 'track/update', trackId: 'track', changes: { height: 140 } }],
	});
});

test('view state publishes meter snapshots and releases idle microphone sessions', () => {
	const fixture = createFixture();
	fixture.setRoutedMeterEnabled(true);
	fixture.state.inputLoudnessMeasurementExplicitlyRunning = true;
	fixture.service.updateTransportState('playing');
	assert.deepEqual(fixture.meterCalls, [false, false]);
	assert.equal(fixture.microphoneStops(), 1);
	assert.equal(fixture.metronomeSynchronizations(), 1);

	fixture.service.updateMeters({ tracks: { track: { peak: 0.5 } }, master: null });
	assert.deepEqual(fixture.state.meters, { tracks: { track: { peak: 0.5 } }, master: null });
	fixture.service.updateMeters(null);
	assert.deepEqual(fixture.state.meters, { tracks: {}, master: null });
	assert.equal(fixture.telemetryPublishes(), 3);
});

test('zoom fitting, viewport changes, and auto-fit state stay within project bounds', () => {
	const fixture = createFixture();
	assert.equal(fixture.service.updateZoom('fit', 480), 480);
	fixture.setContentDurationFrames(0);
	assert.equal(fixture.service.updateZoom('fit', 0), 1_000);
	fixture.state.timelineViewportWidth = 0;
	assert.equal(fixture.service.updateZoom('in', undefined), 2_000);
	assert.equal(fixture.state.sampleEditMode, null);
	fixture.setSampleEditing(true);
	assert.equal(fixture.service.updateZoom('out', undefined), 1_000);

	assert.equal(fixture.service.setTimelineViewportWidth(800), 800);
	assert.equal(fixture.service.setTimelineViewportWidth(800), 800);
	assert.equal(fixture.service.setTimelineViewportWidth(-1), 0);
	assert.equal(fixture.service.setAutoFitTrackHeight(1), true);
	assert.equal(fixture.service.setAutoFitTrackHeight(0), false);
	assert.ok(fixture.projectPublishes() >= 7);
});

test('visible and persisted track heights filter invalid rows and handle blocked edits', () => {
	const fixture = createFixture();
	assert.deepEqual(fixture.service.setVisibleTrackHeights({
		track: 20,
		second: 150.6,
		missing: 200,
		invalid: Number.NaN,
	}), { track: 40, second: 151 });
	assert.equal(fixture.service.adjustTrackHeight('track', 10), 'track');
	assert.throws(() => fixture.service.adjustTrackHeight('missing', 1), /Track not found/u);

	assert.ok(fixture.service.adjustAllTrackHeights(5));
	assert.equal(fixture.state.autoFitTrackHeight, false);
	fixture.setBlocked(true);
	assert.equal(fixture.service.adjustAllTrackHeights(5), null);
	assert.equal(fixture.service.resizeTrackHeight('track', 200), null);
	fixture.setBlocked(false);
	assert.throws(() => fixture.service.resizeTrackHeight('missing', 100), /Track not found/u);

	fixture.setProject({ tracks: [] });
	assert.deepEqual(fixture.service.adjustAllTrackHeights(10), { tracks: [] });
	assert.ok(fixture.projectPublishes() >= 1);
});

test('unchanged fitted heights publish without emitting an empty command batch', () => {
	const fixture = createFixture();
	fixture.service.setVisibleTrackHeights({ track: 100, second: 114 });
	assert.equal(fixture.service.resizeTrackHeight('track', 100, { second: 114 }), 'track');
	assert.equal(fixture.commands.length, 0);
	assert.equal(fixture.projectPublishes(), 1);
});
