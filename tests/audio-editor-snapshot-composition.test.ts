/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSnapshotComposition } from '../src/common/editor/controller/snapshot-composition.ts';
import { stateFixture } from './helpers/audio-editor-snapshot-state.ts';
import { DEFAULT_SOUND_ACTIVATION_PREFERENCES } from '../src/common/editor/sound-activation-preferences.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

function fixture() {
	const project = { id: 'project', clips: [{ id: 'clip', kind: 'video', videoEffects: [{ id: 'effect', params: { amount: 0 } }] }] };
	const state = { ...stateFixture(), disposed: false };
	const gestures = new Map<string, { params: { amount: number } }>();
	const telemetry = { positionFrame: 0, durationFrames: 100, transportState: 'stopped', recorder: null,
		timedRecording: null, timedRecordingCancelling: false, meters: null, inputMeterDb: -Infinity,
		inputMeter: null, inputMeters: {}, exportProgress: 0 };
	const channels = createSnapshotComposition({
		document: {
			state, product: null, productId: 'framescaper', capabilities: {}, locale: 'en',
			getCurrentProject: () => project, projectForPlayback: candidate => candidate,
			getProjectTabs: () => [], getCurrentTabMetadata: () => ({}), recordingPreviewSnapshot: () => null,
			getSoundActivationSnapshot: () => ({ preferences: DEFAULT_SOUND_ACTIVATION_PREFERENCES,
				preferenceMutationBlocked: false, preferenceMutationBlockReason: null, sources: [] }),
			sampleEditingAvailable: () => false, canUndo: () => false, canRedo: () => false,
			historyEntrySummary: entry => entry, getSelectionEffectParams: () => ({}),
			getStorageStatus: () => ({ state: 'indexeddb', backend: 'indexeddb', persistent: true, ephemeral: false, degradedReason: null }),
		},
		telemetry, audioDevices: { preferredInputDeviceId: 'default', preferredInputChannelCount: 1,
			preferredOutputDeviceId: 'default', activeOutputDeviceId: 'default', audioInputAccess: false,
			audioInputDevices: [], audioOutputDevices: [], recordingPoolSources: [], audioOutputStatus: '' },
		engine: {}, mediaDevices: undefined, copy: ENGLISH_COPY, videoEffectGestures: gestures,
		videoEffectGestureKey: (clip, effect) => `${clip}:${effect}`,
	});
	return { channels, project, state, gestures, telemetry };
}

test('snapshot composition separates realtime publication from document notifications', () => {
	const f = fixture();
	let documents = 0, telemetry = 0;
	f.channels.document.subscribe(() => { documents++; });
	f.channels.telemetry.subscribe(() => { telemetry++; });
	const document = f.channels.document.get();
	f.telemetry.positionFrame = 42;
	f.channels.telemetry.publish();
	assert.equal(f.channels.telemetry.get().positionFrame, 42);
	assert.equal(f.channels.document.get(), document);
	assert.equal(documents, 0);
	assert.equal(telemetry, 1);
	f.state.disposed = true;
	assert.equal(f.channels.document.publish(), false);
	assert.equal(f.channels.document.publish({ force: true }), true);
	assert.equal(documents, 1);
});

test('gesture previews are live snapshots and never mutate the project retained for saving', () => {
	const f = fixture();
	f.gestures.set('clip:effect', { params: { amount: 0.5 } });
	f.channels.document.publish();
	const first = f.channels.document.get();
	assert.equal(first.project?.clips[0].videoEffects[0].params.amount, 0.5);
	assert.equal(f.project.clips[0].videoEffects[0].params.amount, 0);
	f.gestures.set('clip:effect', { params: { amount: 0.75 } });
	f.channels.document.publish();
	assert.equal(f.channels.document.get().project?.clips[0].videoEffects[0].params.amount, 0.75);
	assert.equal(first.project?.clips[0].videoEffects[0].params.amount, 0.5);
});
