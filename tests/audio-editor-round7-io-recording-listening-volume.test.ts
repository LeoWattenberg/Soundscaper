/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecordingController } from '../src/common/editor/recording.js';
import type { RecordingControllerFactoryOptions } from '../src/common/editor/controller/recording/recording-transaction-types.ts';
import {
	createAudioEditorController, createCapturePool, createFfmpegStub,
	createMockStream, createMockTrack, createProjectStore,
	createRecordingControllerFactory, createRecordingEngine,
} from './helpers/audio-editor-recording-controller-harness.js';

for (const routed of [false, true]) test(`${routed ? 'routed' : 'default'} recording uses the live listening destination and keeps captured samples`, async () => {
	const store = createProjectStore();
	const destination = { gain: 0 };
	const engine = { ...createRecordingEngine(), getPlaybackDestination: () => destination };
	const stream = createMockStream([createMockTrack('audio', { channelCount: 1 })]);
	const created: RecordingControllerFactoryOptions[] = [];
	const controller = createAudioEditorController(null, { engine, store, ffmpeg: createFfmpegStub(),
		recordingCapturePool: createCapturePool({ hardware: { default: stream } }),
		recordingControllerFactory: createRecordingControllerFactory(created),
	});
	try {
		await controller.ready;
		const trackId: string = controller.getSnapshot().project.tracks[0].id;
		if (routed) await controller.actions.recording.setTrackInput(trackId, {
			kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 1,
		});
		await controller.actions.recording.setMonitoring(true);
		await controller.actions.recording.start({ trackId });
		assert.equal(created.length, 1);
		const request = created[0]!;
		assert.equal(request.monitor, true);
		assert.equal('monitorDestination' in request ? request.monitorDestination : undefined, destination);
		const samples = new Float32Array(8_192).fill(0.25);
		await request.onChunk({ frameStart: 0, frames: samples.length, channels: [samples] });
		await controller.actions.recording.stop();
		const sourceId: string = controller.getSnapshot().project.sources[0].id;
		const stored: { channels: Float32Array[] } = await store.readSourceChunk(sourceId, 0);
		assert.equal(stored.channels[0]![0], 0.25, 'listening mute leaves the captured PCM untouched');
	} finally { await controller.dispose(); }
});

for (const listening of [false, true]) test(`recording worklet connects to ${listening ? 'the owned listening output' : 'the standalone destination'}`, async () => {
	const connected: unknown[] = [];
	const speaker = { id: 'speaker' };
	const monitor = { id: 'listening-gain' };
	const context = { sampleRate: 48_000, destination: speaker,
		audioWorklet: { async addModule() {} },
		createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
	};
	const request = { context, stream: { getTracks: () => [] }, monitor: true,
		...(listening ? { monitorDestination: monitor } : {}),
		nodeFactory: () => ({ port: { onmessage: null, onmessageerror: null,
			postMessage() {}, start() {} }, onprocessorerror: null,
			connect(destination: unknown) { connected.push(destination); }, disconnect() {},
		}),
	};
	const recorder = await createRecordingController(request);
	try { assert.deepEqual(connected, [listening ? monitor : speaker]); }
	finally { await recorder.dispose(); }
});
