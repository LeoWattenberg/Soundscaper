/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperBrowserRecorderFactory } from '../src/common/editor/controller/capture/internal/browser/framescaper-browser-recorder-factory.ts';
import type { FramescaperWorkletRecordingControllerOptions } from '../src/common/editor/controller/capture/internal/browser/framescaper-browser-audio-recorder.ts';
import type { CapturePacket } from '../src/common/editor/framescaper-capture-domain.ts';

for (const role of ['microphone', 'system-audio'] as const) {
	for (const monitoring of [false, true]) {
		test(`Monitor microphone=${String(monitoring)} records ${role} without monitoring other source roles`, async () => {
			let options: FramescaperWorkletRecordingControllerOptions | null = null;
			const packets: Readonly<CapturePacket>[] = [];
			const track = { kind: 'audio', stop() {}, getSettings: () => ({ sampleRate: 48_000, channelCount: 1 }) };
			const stream = { getTracks: () => [track], getAudioTracks: () => [track], getVideoTracks: () => [] };
			const createRecorder = createFramescaperBrowserRecorderFactory({
				MediaRecorder: null, MediaStreamTrackProcessor: null,
				getAudioContext: () => ({ sampleRate: 48_000 }),
				recordingControllerFactory: (settings) => {
					options = settings;
					return { start() {}, pause: () => true, resume: () => true, stop: async () => {}, detach: async () => {} };
				},
			});
			const recorder = await createRecorder({
				sessionId: 'capture-session', streamId: `stream-${role}`, sourceId: `source-${role}`,
				source: { sourceId: role, role, track, stream, settings: {}, capabilities: {} },
				monitoring, inputGain: 0.5,
				onPacket: async packet => { packets.push(packet); },
				onError(error) { throw error; }, onBackpressure() { throw new Error('Unexpected backpressure.'); },
			});
			const settings = options as FramescaperWorkletRecordingControllerOptions | null;
			assert.ok(settings);
			assert.equal(settings.monitor, role === 'microphone' && monitoring);
			assert.equal(settings.inputGain, 0.5);
			recorder.start(100_000);
			await settings.onChunk({ frameStart: 0, frames: 2, channels: [Float32Array.of(0.25, -0.5)] });
			await recorder.stop();
			assert.equal(packets[0]?.kind, 'pcm-audio');
			if (packets[0]?.kind === 'pcm-audio') {
				assert.deepEqual([...packets[0].samples], [0.25, -0.5]);
				assert.equal(packets[0].presentationTimeUs, 100_000);
			}
			await recorder.dispose();
		});
	}
}
