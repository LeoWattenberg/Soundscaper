/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyVideoEffectGesturePreviews,
	createAudioDeviceSnapshot,
	createEditorTelemetrySnapshot,
} from '../src/common/editor/controller/snapshot-model.ts';

test('video effect gesture previews replace only the active immutable params', () => {
	const project = {
		clips: [{
			id: 'clip-1',
			kind: 'video',
			videoEffects: [{ id: 'effect-1', params: { amount: 1 } }],
		}],
	};
	const unchanged = applyVideoEffectGesturePreviews(project, new Map(), (clipId, effectId) => `${clipId}:${effectId}`);
	assert.equal(unchanged, project);
	const preview = applyVideoEffectGesturePreviews(
		project,
		new Map([['clip-1:effect-1', { params: { amount: 2 } }]]),
		(clipId, effectId) => `${clipId}:${effectId}`,
	);
	assert.notEqual(preview, project);
	assert.deepEqual(preview?.clips[0]?.videoEffects?.[0]?.params, { amount: 2 });
	assert.deepEqual(project.clips[0]?.videoEffects?.[0]?.params, { amount: 1 });
});

test('telemetry snapshots normalize playback defaults and isolate meter maps', () => {
	const inputMeters = { microphone: { peak: -12 } };
	const snapshot = createEditorTelemetrySnapshot({
		positionFrame: 12,
		durationFrames: 48,
		transportState: 'playing',
		recorder: {},
		timedRecording: null,
		timedRecordingCancelling: false,
		meters: { master: null },
		inputMeterDb: -12,
		inputMeter: null,
		inputMeters,
		taskProgress: { id: 'task-1', kind: 'export', label: 'Encoding', value: 0.25 },
		exportProgress: 0.5,
	}, { getState: () => ({ playbackRate: 0 }) });
	assert.equal(snapshot.playbackMode, 'normal');
	assert.equal(snapshot.playbackRate, 1);
	assert.equal(snapshot.recording, true);
	assert.notEqual(snapshot.inputMeters, inputMeters);
	assert.deepEqual(snapshot.taskProgress, {
		id: 'task-1', kind: 'export', label: 'Encoding', value: 0.25,
	});
	assert.equal(snapshot.exportProgress, 0.25);
	assert.equal(Object.isFrozen(snapshot), true);
});

test('audio-device snapshots distinguish availability, support, and active output', () => {
	const snapshot = createAudioDeviceSnapshot({
		preferredInputDeviceId: 'display',
		preferredInputChannelCount: 2,
		preferredOutputDeviceId: 'speaker-1',
		activeOutputDeviceId: '',
		audioInputAccess: true,
		audioInputDevices: [],
		audioOutputDevices: [{ deviceId: 'speaker-1' }],
		recordingPoolSources: [{ kind: 'display' }],
		audioOutputStatus: 'active',
	}, {
		getOutputDeviceState: () => ({ activeDeviceId: 'speaker-1', supported: true }),
		getPlaybackGain: () => 0.5,
	}, {
		getDisplayMedia: () => undefined,
	}, 'default', 'display');
	assert.equal(snapshot.preferredInputAvailable, true);
	assert.equal(snapshot.preferredOutputAvailable, true);
	assert.equal(snapshot.displayCaptureOpen, true);
	assert.equal(snapshot.activeOutputDeviceId, 'speaker-1');
	assert.equal(snapshot.playbackGain, 0.5);
});
