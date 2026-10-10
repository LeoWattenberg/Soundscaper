/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptFramescaperRecordingControllerFactory } from '../src/common/editor/controller/capture/framescaper-recording-factory-adapter.ts';
import type { RecordingControllerFactoryOptions } from '../src/common/editor/controller/recording/recording-transaction-types.ts';

for (const sampleRate of [44_100, 48_000]) test(`native capture listening owns the ${sampleRate} Hz context while preserving recorder input`, async () => {
	const context = contextFixture(sampleRate);
	const listening = listeningFixture(0);
	const calls: Array<RecordingControllerFactoryOptions & { readonly monitorDestination?: GainNode }> = [];
	let detached = 0;
	const factory = adaptFramescaperRecordingControllerFactory(async options => {
		calls.push(options);
		return { start() {}, pause() {}, resume() {}, setMonitoring() {}, setInputGain() {}, stop: async () => {},
			detach: async () => { detached++; } };
	}, listening);
	assert.ok(factory);
	const input = request(context);
	const recorder = await factory(input);
	const captured = calls[0];
	assert.ok(captured);
	assert.equal(captured.context, input.context);
	assert.equal(captured.stream, input.stream);
	assert.equal(captured.inputGain, 0.5);
	assert.equal(captured.monitor, true);
	assert.equal(captured.monitorDestination, context.output, 'route the monitor to its own context-local listening output');
	assert.equal(context.output.gain.value, 0);
	assert.equal(context.connectedTo(), context.destination);
	assert.equal(listening.listeners.size, 1);
	listening.setGain(0.25);
	assert.equal(context.output.gain.value, 0.25);
	listening.setGain(1);
	assert.equal(context.output.gain.value, 1);
	const samples = Float32Array.of(0, 0.125, -0.125);
	await captured.onChunk({ frameStart: 0, frames: samples.length, channels: [samples] });
	assert.equal(input.received()[0]?.channels[0], samples);
	await recorder.detach?.();
	await recorder.detach?.();
	assert.equal(detached, 1);
	assert.equal(context.disconnects(), 1);
	assert.equal(listening.listeners.size, 0);
	listening.setGain(0);
	assert.equal(context.output.gain.value, 1, 'a retired monitor no longer consumes editor publications');
});

test('failed native recorder allocation releases the listening node and publication listener', async () => {
	const context = contextFixture(48_000);
	const listening = listeningFixture(0.5);
	const factory = adaptFramescaperRecordingControllerFactory(async () => { throw new Error('Capture input disappeared.'); }, listening);
	assert.ok(factory);
	await assert.rejects(factory(request(context)), /Capture input disappeared/u);
	assert.equal(context.disconnects(), 1);
	assert.equal(listening.listeners.size, 0);
});

test('unmonitored native capture retains its input and allocates no listening output', async () => {
	const context = contextFixture(48_000);
	const listening = listeningFixture(0);
	const calls: Array<RecordingControllerFactoryOptions & { readonly monitorDestination?: GainNode }> = [];
	const factory = adaptFramescaperRecordingControllerFactory(async options => {
		calls.push(options);
		return { start() {}, pause() {}, resume() {}, setMonitoring() {}, setInputGain() {}, stop: async () => {} };
	}, listening);
	assert.ok(factory);
	await factory({ ...request(context), monitor: false });
	assert.equal(calls[0]?.monitorDestination, undefined);
	assert.equal(listening.listeners.size, 0);
	assert.equal(context.connectedTo(), null);
});

function contextFixture(sampleRate: number) {
	let connected: unknown = null;
	let disconnects = 0;
	const output = {
		gain: { value: 1, setValueAtTime(value: number) { this.value = value; } },
		connect(destination: unknown) { connected = destination; },
		disconnect() { disconnects++; },
	};
	return {
		sampleRate, currentTime: 0, destination: {}, output,
		resume: async () => {},
		createGain: () => output,
		connectedTo: () => connected,
		disconnects: () => disconnects,
	};
}

function listeningFixture(initial: number) {
	let gain = initial;
	const listeners = new Set<() => void>();
	return {
		listeners,
		getGain: () => gain,
		subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
		setGain(value: number) { gain = value; for (const listener of listeners) listener(); },
	};
}

function request(context: ReturnType<typeof contextFixture>) {
	const received: Array<Parameters<RecordingControllerFactoryOptions['onChunk']>[0]> = [];
	return {
		context, stream: { getAudioTracks: () => [] }, channelCount: 1, chunkFrames: 4_096,
		monitor: true, inputGain: 0.5, maxPendingChunks: 4,
		onChunk: async (chunk: Parameters<RecordingControllerFactoryOptions['onChunk']>[0]) => { received.push(chunk); },
		onError: () => {}, received: () => received,
	};
}
