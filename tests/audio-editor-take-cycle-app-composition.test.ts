/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createTakeCycleAppComposition,
	type TakeCycleAppCompositionDependencies,
} from '../src/common/editor/controller/take-cycle-app-composition.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';
import type { RecordingControllerFactoryOptions } from '../src/common/editor/controller/recording-transaction-types.ts';
import { createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createProjectStore } from '../src/common/editor/storage.js';

const NOW = '2026-08-12T12:00:00.000Z';
const PROJECT_ID = 'project-cycle-live-input';

test('routed cycle recorders honour monitoring and input gain changed after app composition', async () => {
	const fixture = await appFixture();
	fixture.state.monitoring = true;
	fixture.state.recordingInputGain = 2.5;
	await fixture.composition.routed.start({ kind: 'take-cycle-routed-capture' }, fixture.scope);

	assert.equal(fixture.recorder.current?.monitor, true);
	assert.equal(fixture.recorder.current?.inputGain, 2.5);
	await fixture.composition.routed.stop();
	await fixture.close();
});

async function appFixture() {
	const store = createProjectStore({
		indexedDB: null, preferOpfs: false, databaseName: uniqueName('cycle-live-input'),
	});
	await store.ready();
	const project = createAudioEditorProjectV17({
		id: PROJECT_ID, title: 'Live input', now: NOW,
		tracks: [createAudioTrackV10({ id: 'track-a', name: 'Vocal', clipIds: [], armed: true })],
		sequences: [{ id: 'main-sequence', trackIds: ['track-a'] }],
		primarySequenceId: 'main-sequence',
		loop: { enabled: true, startFrame: 0, endFrame: 4 },
	});
	await store.projectRepository.save(project);
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const generation = new EditorProjectGeneration();
	generation.activate(PROJECT_ID);
	const state = {
		history: null, saveState: 'saved', monitoring: false, recordingInputGain: 1,
		recordingRouting: Object.freeze({
			routes: Object.freeze({ 'track-a': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 } }),
		}),
	} as unknown as TakeCycleAppCompositionDependencies['state'] & { monitoring: boolean; recordingInputGain: number };
	const recorder: { current?: RecordingControllerFactoryOptions } = {};
	const stream = {
		getAudioTracks: () => [{ readyState: 'live', getSettings: () => ({ channelCount: 1 }) }],
		getTracks: () => [],
	};
	const ids = new Map<string, number>();
	const dependencies: TakeCycleAppCompositionDependencies = {
		lifetime,
		store: store as unknown as TakeCycleAppCompositionDependencies['store'],
		session: {} as TakeCycleAppCompositionDependencies['session'],
		projectGeneration: {
			capture: () => generation.capture(),
			assertCurrent: (token) => generation.assertCurrent(token),
		},
		state,
		recording: {
			capturePool: { acquireHardware: async () => stream, acquireDisplay: async () => stream },
			engine: {
				getAudioContext: async () => ({ sampleRate: 48_000, currentTime: 1, resume: async () => {} }),
				setLoop() {}, seek() {}, playAt: async () => {}, pause() {},
			},
			sourceChunkFrames: 4,
			streamAudioChannelCount: () => 1,
			recordingStreamIsLive: () => true,
			createRecorder: async (options) => {
				recorder.current = options;
				return {
					start() {}, pause: () => false, resume: () => false,
					stop: async () => {}, dispose: async () => {},
					setMonitoring() {}, setInputGain() {},
				};
			},
			beginPlaybackCachePreparation: async () => {},
			handleError() {},
		},
		getProject: () => project as ReturnType<TakeCycleAppCompositionDependencies['getProject']>,
		setProject() {},
		activeSelection: () => null,
		findAudioSource: () => null,
		trackName: () => 'Vocal',
		getRoutes: () => state.recordingRouting.routes,
		soundActivationEnabled: () => false,
		recordingRouteSourceKey: ({ deviceId }) => `device:${String(deviceId)}`,
		createId(prefix) {
			const next = (ids.get(prefix) ?? 0) + 1;
			ids.set(prefix, next);
			return `${prefix}-${String(next)}`;
		},
		createRecordingName: (trackName) => `Cycle ${trackName}`,
		preflightRecording: async () => {},
		releaseInputs() {},
		activateStoredSource() {},
		publishProject() {},
		synchronizeProject() {},
		now: () => NOW,
	};
	const composition = createTakeCycleAppComposition(dependencies);
	const scope = Object.freeze({
		generation: 1, projectId: PROJECT_ID,
		assertCurrent: () => generation.assertCurrent(generation.capture()),
	});
	return { composition, scope, state, recorder, close: () => store.close() };
}

function uniqueName(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
