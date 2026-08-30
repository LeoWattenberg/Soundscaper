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

test('native route preparation disposes its transport when graph construction fails', async () => {
	const failure = new Error('planned sink construction failure');
	let disposals = 0;
	const context = {
		sampleRate: 48_000,
		createGain: () => { throw failure; },
	} as unknown as AudioContext;
	const renderer = createSoundscaperNativeAudioRenderer({
		engine: {
			getAudioContext: async () => context,
			getState: () => ({ state: 'stopped' }),
			pause() {},
			play: async () => undefined,
		},
		windowValue: null,
		createNode: async () => ({
			node: audioNode('device', []) as unknown as AudioNode,
			attach: (_port: unknown, value: { generation: number }) => value.generation,
			revoke: () => 1,
			notifyPeerLoss: () => 1,
			calibrate: async () => 0,
			dispose: () => { disposals += 1; },
		}),
	});
	await assert.rejects(() => renderer.prepare('session-failed', {
		candidates: [{ backend: 'alsa', deviceHandle: 'opaque-device' }],
		direction: 'output', mode: 'shared', sampleRate: 48_000, periodFrames: 128, channelCount: 2,
	}), failure);
	assert.equal(disposals, 1, 'the worklet transport cannot outlive a failed route preparation');
	await renderer.dispose();
});

test('renderer disposal waits for and revokes a route still being prepared', async () => {
	const events: unknown[] = [];
	const sink = Object.assign(audioNode('sink', events), { gain: { value: 1 } });
	const context = {
		sampleRate: 48_000,
		destination: audioNode('destination', events),
		createGain: () => sink,
	} as unknown as AudioContext;
	let disposals = 0;
	const transport = {
		node: audioNode('device', events) as unknown as AudioNode,
		attach: (_port: unknown, value: { generation: number }) => value.generation,
		revoke: () => 1,
		notifyPeerLoss: () => 1,
		calibrate: async () => 0,
		dispose: () => { disposals += 1; },
	};
	const creation = deferred<typeof transport>();
	const started = deferred<void>();
	const renderer = createSoundscaperNativeAudioRenderer({
		engine: {
			getAudioContext: async () => context,
			getState: () => ({ state: 'stopped' }),
			pause() {},
			play: async () => undefined,
		},
		windowValue: null,
		createNode: async () => { started.resolve(); return creation.promise; },
	});
	const preparing = renderer.prepare('session-pending', {
		candidates: [{ backend: 'alsa', deviceHandle: 'opaque-device' }],
		direction: 'output', mode: 'shared', sampleRate: 48_000, periodFrames: 128, channelCount: 2,
	});
	await started.promise;
	const rejectedPreparation = assert.rejects(preparing, /disposed/u);
	let disposalSettled = false;
	const disposal = renderer.dispose().then(() => { disposalSettled = true; });
	await new Promise<void>((resolve) => setImmediate(resolve));
	const settledBeforeCreation = disposalSettled;
	creation.resolve(transport);
	const settlements = await Promise.allSettled([rejectedPreparation, disposal]);
	assert.equal(settledBeforeCreation, false, 'disposal must own pending route construction');
	assert.equal(settlements[0]?.status, 'fulfilled');
	assert.equal(settlements[1]?.status, 'fulfilled');
	assert.equal(disposals, 1, 'the late worklet transport is revoked exactly once');
});

test('an older route preparation cannot overwrite a newer completed route', async () => {
	const events: unknown[] = [];
	const context = {
		sampleRate: 48_000,
		destination: audioNode('destination', events),
		createGain: () => Object.assign(audioNode('sink', events), { gain: { value: 1 } }),
	} as unknown as AudioContext;
	const disposals = [0, 0];
	const transports = [0, 1].map((index) => ({
		node: audioNode(`device-${String(index)}`, events) as unknown as AudioNode,
		attach: (_port: unknown, value: { generation: number }) => value.generation,
		revoke: () => 1,
		notifyPeerLoss: () => 1,
		calibrate: async () => 0,
		dispose: () => { disposals[index] += 1; },
	}));
	const firstCreation = deferred<(typeof transports)[number]>();
	const firstStarted = deferred<void>();
	let creation = 0;
	const renderer = createSoundscaperNativeAudioRenderer({
		engine: {
			getAudioContext: async () => context,
			getState: () => ({ state: 'stopped' }),
			pause() {},
			play: async () => undefined,
		},
		windowValue: null,
		createNode: async () => {
			const index = creation++;
			if (index === 0) {
				firstStarted.resolve();
				return firstCreation.promise;
			}
			return transports[1];
		},
	});
	const first = renderer.prepare('session-old', {
		candidates: [{ backend: 'alsa', deviceHandle: 'old-device' }],
		direction: 'output', mode: 'shared', sampleRate: 48_000, periodFrames: 128, channelCount: 2,
	});
	await firstStarted.promise;
	await renderer.prepare('session-new', {
		candidates: [{ backend: 'alsa', deviceHandle: 'new-device' }],
		direction: 'output', mode: 'shared', sampleRate: 48_000, periodFrames: 128, channelCount: 2,
	});
	const stale = assert.rejects(first, /superseded/u);
	firstCreation.resolve(transports[0]);
	const staleSettlement = await Promise.allSettled([stale]);
	await renderer.release('session-new');
	await renderer.dispose();
	assert.equal(staleSettlement[0]?.status, 'fulfilled');
	assert.deepEqual(disposals, [1, 1], 'both the stale and current transports retire exactly once');
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

function deferred<Value>(): Readonly<{
	promise: Promise<Value>;
	resolve(value: Value): void;
}> {
	let settle: (value: Value) => void = () => undefined;
	const promise = new Promise<Value>((resolve) => { settle = resolve; });
	return Object.freeze({ promise, resolve: (value: Value) => settle(value) });
}
