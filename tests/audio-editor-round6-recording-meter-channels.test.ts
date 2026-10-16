/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createMicrophoneMeterService, type MicrophoneMeterState } from '../src/common/editor/controller/recording/microphone-meter-service.ts';
import { createOwnedStateAccess } from '../src/common/editor/controller/shared/owned-state.ts';

type Mutable<Value> = { -readonly [Key in keyof Value]: Value[Key] };
interface ChannelReading { readonly peak: number; readonly rms: number }
interface Reading { readonly channels?: readonly ChannelReading[]; readonly peak?: number; readonly rms?: number }

for (const optionalLoudness of [true, false]) {
	test(`the actual stereo microphone analyser bank preserves silence (loudness=${String(optionalLoudness)})`, async () => {
		const harness = createHarness([.5, 0], optionalLoudness);
		assert.equal(await harness.service.setMicrophoneMetering(true), true);
		assert.equal(harness.state.inputMeterDb, 20 * Math.log10(.5));
		assert.deepEqual(harness.reading().channels, [{ peak: .5, rms: .5 }, { peak: 0, rms: 0 }]);
		harness.state.recordingInputGain = 2;
		harness.tick();
		assert.deepEqual(harness.reading().channels, [{ peak: 1, rms: 1 }, { peak: 0, rms: 0 }]);
		if (!optionalLoudness) {
			assert.equal(harness.reading().peak, 1);
			assert.equal(harness.reading().rms, Math.sqrt(.5));
		}
		harness.service.dispose();
		assert.equal(harness.state.inputMeter, null);
	});
}

test('loudness callbacks retain programme fields and independently measured input channels', async () => {
	const harness = createHarness([.5, 0], true);
	await harness.service.setMicrophoneMetering(true);
	const programme = Object.freeze({ peak: .5, rms: .35, dbfs: -6, truePeak: .6, integratedLufs: -20, running: false });
	harness.publish(programme);
	assert.equal(harness.state.inputMeterDb, -6);
	assert.deepEqual(harness.state.inputMeter, { ...programme, channels: [{ peak: .5, rms: .5 }, { peak: 0, rms: 0 }] });
	assert.equal('channels' in programme, false);
	harness.levels[0] = .25;
	harness.tick();
	assert.deepEqual(harness.state.inputMeter, { ...programme, channels: [{ peak: .25, rms: .25 }, { peak: 0, rms: 0 }] });
	harness.service.pauseLoudnessMeasurement();
	harness.publish(programme);
	assert.equal(harness.reading().channels?.[1]?.peak, 0);
	harness.service.dispose();
});

test('the mono fallback reports its actual signal without inventing a second channel', async () => {
	const harness = createHarness([.25], false);
	await harness.service.setMicrophoneMetering(true);
	assert.equal(harness.state.inputMeterDb, 20 * Math.log10(.25));
	assert.deepEqual(harness.reading().channels, [{ peak: .25, rms: .25 }]);
	harness.service.dispose();
});

function createHarness(levels: number[], optionalLoudness: boolean) {
	const state: Mutable<MicrophoneMeterState> = {
		disposed: false, microphoneMetering: false, recorder: null, recordingStarting: false,
		timedRecordingPreparing: false, timedRecording: null,
		preferences: { recording: { retainInputs: false } }, recordingInputGain: 1,
		transportState: 'stopped', inputLoudnessMeasurementManuallyPaused: false,
		inputLoudnessMeasurementExplicitlyRunning: false, inputMeterDb: -60, inputMeter: null,
		selectedTrackId: 'track', recordingRouting: { routes: {
			track: { kind: 'device', deviceId: 'ordinary', channelStart: 0, channelCount: levels.length },
		} },
	};
	const node = () => ({ connect: () => undefined, disconnect: () => undefined });
	let analyserIndex = 0;
	let tick = (): void => undefined;
	let publish = (_reading: unknown): void => undefined;
	const stream = { getAudioTracks: () => [] };
	const context = {
		destination: node(), createMediaStreamSource: () => node(),
		createChannelSplitter: () => node(), createChannelMerger: () => node(),
		createAnalyser: () => {
			const channel = analyserIndex++;
			return { ...node(), fftSize: 256, smoothingTimeConstant: 0,
				getFloatTimeDomainData: (target: Float32Array) => { target.fill(levels[channel] ?? 0); } };
		},
	};
	const service = createMicrophoneMeterService({
		state: createOwnedStateAccess(state, state), defaultDeviceId: 'ordinary',
		recordingCapturePool: { acquireHardware: async () => stream, releaseHardware: () => undefined },
		getAudioContext: async () => context,
		createLoudnessMeterNode: async (_context, options) => {
			if (!optionalLoudness) throw new Error('optional worklet unavailable');
			publish = options.onMeter;
			return { node: node(), setRunning: () => undefined, setInputGain: () => undefined,
				reset: () => undefined, requestSnapshot: () => undefined };
		},
		streamAudioChannelCount: () => levels.length, projectSampleRate: () => 48_000,
		persistSetting: () => undefined, publishDocumentSnapshot: () => undefined,
		publishTelemetrySnapshot: () => undefined, syncRecordingPoolSnapshot: () => undefined,
		handleError: (error) => { throw error; },
		scheduleInterval: (callback) => { tick = callback; return 1; }, clearInterval: () => undefined,
	});
	return { state, service, levels, reading: (): Reading => state.inputMeter && typeof state.inputMeter === 'object' ? state.inputMeter as Reading : {},
		tick: () => { tick(); }, publish: (reading: unknown) => { publish(reading); } };
}
