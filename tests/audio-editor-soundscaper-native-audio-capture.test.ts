/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createRecordingController, requestHardwareInput } from '../src/common/editor/recording.js';
import { createSoundscaperNativeAudioRenderer } from '../src/common/editor/soundscaper-native-audio-renderer.ts';
import {
	acquireSoundscaperNativeAudioCapture,
	claimSoundscaperNativeAudioCapture,
	soundscaperNativeAudioCaptureHasActiveLease,
} from '../src/common/editor/soundscaper-native-audio-capture.ts';

test('an ended native capture lease no longer blocks idle-only calibration', () => {
	const stream = captureStream();
	const claim = claimSoundscaperNativeAudioCapture({
		sessionId: 'session-idle',
		context: { createMediaStreamDestination: () => ({ stream }) } as unknown as AudioContext,
		node: audioNode('device', []) as unknown as AudioNode,
		channelCount: 2, sampleRate: 48_000,
	});
	claim.activate();
	const lease = acquireSoundscaperNativeAudioCapture({ channelCount: 2, sampleRate: 48_000 });
	assert.ok(lease);
	assert.equal(soundscaperNativeAudioCaptureHasActiveLease(), true);
	lease.getTracks()[0].stop();
	assert.equal(soundscaperNativeAudioCaptureHasActiveLease(), false);
	claim.revoke();
});

/** Stands in for the window the preload relay posts to; offers carry it as their source. */
const FIXTURE_WINDOW_SOURCE = {} as Window;

test('bound native input is pulled silently and records exact channels through the direct node', async () => {
	const events: unknown[] = [];
	const device = audioNode('device', events);
	const destination = audioNode('destination', events);
	const sink = audioNode('sink', events) as ReturnType<typeof audioNode> & { gain: { value: number } };
	sink.gain = { value: 1 };
	const stream = captureStream();
	const context = {
		sampleRate: 48_000,
		destination,
		audioWorklet: { addModule: async () => undefined },
		createGain: () => sink,
		createMediaStreamDestination: () => ({ stream }),
	} as unknown as AudioContext;
	const callbacks: {
		receive: ((event: Event) => void) | null;
		reportDeviceLoss: (() => void) | null;
	} = { receive: null, reportDeviceLoss: null };
	const renderer = createSoundscaperNativeAudioRenderer({
		engine: {
			getAudioContext: async () => context,
			getState: () => ({ state: 'stopped' }),
			pause() {},
			play: async () => undefined,
		},
		windowValue: {
			window: FIXTURE_WINDOW_SOURCE,
			addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
				callbacks.receive = listener as (event: Event) => void;
			},
			removeEventListener: () => undefined,
		} as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>,
		createNode: async (_context, options) => {
			callbacks.reportDeviceLoss = () => options.onClose({ reason: 'device-loss' });
			return {
				node: device as unknown as AudioNode,
				attach: (_port: unknown, value: { generation: number }) => value.generation,
				revoke: () => 1,
				notifyPeerLoss: () => 1,
				calibrate: async () => 0,
				dispose: () => undefined,
			};
		},
	});
	await renderer.prepare('session-1', {
		candidates: [{ backend: 'alsa', deviceHandle: 'opaque-device' }],
		direction: 'input', mode: 'shared', sampleRate: 48_000, periodFrames: 128, channelCount: 2,
	}, { backend: 'alsa', deviceHandle: 'opaque-device' });
	assert.deepEqual(events.slice(0, 2), [['connect', 'device', 'sink'], ['connect', 'sink', 'destination']]);
	assert.equal(sink.gain.value, 0, 'native capture is pulled without direct monitoring');
	callbacks.receive?.({
		source: FIXTURE_WINDOW_SOURCE,
		data: { type: 'soundscaper-native-realtime-port-v1', offer: {
			protocolVersion: 1, generation: 1, sampleFormat: 'f32-planar', sampleRate: 48_000,
			channelCount: 2, frameCount: 128, queueCapacity: 8, startFrame: 0,
		} },
		ports: [{ close() {} }],
	} as unknown as Event);
	const leased = await requestHardwareInput({
		deviceId: 'native:alsa:in:opaque-device', channelCount: 2, sampleRate: 48_000,
	} as never);
	const recorder = workletNode(events);
	const chunks: unknown[] = [];
	const controller = await createRecordingController({
		context,
		stream: leased,
		channelCount: 2,
		chunkFrames: 128,
		nodeFactory: () => recorder,
		onChunk: async (chunk: unknown) => { chunks.push(chunk); },
	} as never);
	controller.start();
	recorder.port.onmessage?.({ data: {
		type: 'audio-chunk', frameStart: 0, frames: 2,
		channels: [new Float32Array([0.25, 0.5]), new Float32Array([-0.25, -0.5])],
	} });
	callbacks.reportDeviceLoss?.();
	await Promise.resolve();
	const stopped = controller.stop();
	assert.equal(recorder.posted.some((value) => value.type === 'stop'), true);
	recorder.port.onmessage?.({ data: { type: 'stopped', frame: 2 } });
	await stopped;
	assert.equal(chunks.length, 1, 'the canonical queued prefix settles before device-loss stop');
	await controller.dispose();
	assert.equal(events.some((value) => Array.isArray(value)
		&& value[0] === 'disconnect' && value[1] === 'device' && value[2] === 'recorder'), true);
});

function audioNode(name: string, events: unknown[]) {
	return {
		name,
		channelCount: 1,
		channelCountMode: 'max',
		channelInterpretation: 'speakers',
		connect(destination: { name?: string }) { events.push(['connect', name, destination.name]); },
		disconnect(destination?: { name?: string }) { events.push(['disconnect', name, destination?.name]); },
	};
}

function captureStream(): MediaStream {
	const create = (): MediaStream => {
		const track = { readyState: 'live', stop() { this.readyState = 'ended'; }, getSettings: () => ({ channelCount: 2 }) };
		return {
			clone: create,
			getTracks: () => [track],
			getAudioTracks: () => [track],
			getVideoTracks: () => [],
		} as unknown as MediaStream;
	};
	return create();
}

function workletNode(events: unknown[]) {
	const posted: Array<Record<string, unknown>> = [];
	return {
		name: 'recorder',
		posted,
		port: {
			onmessage: null as ((event: { data: Record<string, unknown> }) => void) | null,
			onmessageerror: null,
			postMessage(value: Record<string, unknown>) { posted.push(value); },
			start() {},
		},
		onprocessorerror: null,
		connect(destination: { name?: string }) { events.push(['connect', 'recorder', destination.name]); },
		disconnect() { events.push(['disconnect', 'recorder']); },
	};
}
