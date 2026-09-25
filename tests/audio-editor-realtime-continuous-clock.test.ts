/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorEngine } from '../src/common/editor/engine.js';

test('realtime capture keeps the clock running and rejects bounded sink overflow', async () => {
	const previousAudioContext = globalThis.AudioContext;
	const previousAudioWorkletNode = globalThis.AudioWorkletNode;
	const context = new MockRealtimeAudioContext();
	let engine: ReturnType<typeof createAudioEditorEngine> | null = null;
	globalThis.AudioContext = function MockAudioContextFactory() { return context; } as unknown as typeof AudioContext;
	globalThis.AudioWorkletNode = MockCaptureNode as unknown as typeof AudioWorkletNode;
	try {
		engine = createAudioEditorEngine();
		engine.loadProject({
			sampleRate: 48_000,
			masterChannels: 1,
			tracks: [],
			clips: [],
			master: { gain: 1, pan: 0, mute: false, effects: [] },
		});
		await assert.rejects(engine.renderMixRealtime({
			outputFrames: 2,
			maximumPendingChunks: 1,
			backpressureHighWaterChunks: 1,
			suspendForBackpressure: false,
			onChunk: () => undefined,
		}), (error: unknown) => {
			assert.equal((error as Error & { code?: string }).code, 'PCM_SINK_BACKPRESSURE');
			return true;
		});
		assert.equal(context.suspendCalls, 0);
		assert.equal(context.closeCalls, 1);
	} finally {
		await engine?.dispose();
		if (previousAudioContext === undefined) Reflect.deleteProperty(globalThis, 'AudioContext');
		else globalThis.AudioContext = previousAudioContext;
		if (previousAudioWorkletNode === undefined) Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
		else globalThis.AudioWorkletNode = previousAudioWorkletNode;
	}
});

class MockNode {
	readonly gain = { value: 1, setValueAtTime() {} };
	connect(target: unknown): unknown { return target; }
	disconnect(): void {}
}

class MockRealtimeAudioContext {
	readonly sampleRate = 48_000;
	readonly currentTime = 0;
	readonly destination = new MockNode();
	readonly audioWorklet = { addModule: async () => undefined };
	state: AudioContextState = 'suspended';
	capture: MockCaptureNode | null = null;
	suspendCalls = 0;
	closeCalls = 0;

	createGain(): MockNode { return new MockNode(); }

	async resume(): Promise<void> {
		this.state = 'running';
		this.capture?.emit({
			type: 'audio-chunk', frameOffset: 0, frames: 1,
			channels: [Float32Array.of(0.5)],
		});
		this.capture?.emit({
			type: 'audio-chunk', frameOffset: 1, frames: 1,
			channels: [Float32Array.of(0.5)],
		});
	}

	async suspend(): Promise<void> {
		this.suspendCalls += 1;
		this.state = 'suspended';
	}

	async close(): Promise<void> {
		this.closeCalls += 1;
		this.state = 'closed';
	}
}

class MockCaptureNode extends MockNode {
	readonly port: {
		onmessage: ((event: { data: Readonly<Record<string, unknown>> }) => void) | null;
		postMessage(message: Readonly<Record<string, unknown>>): void;
		start(): void;
	};
	onprocessorerror: (() => void) | null = null;

	constructor(context: MockRealtimeAudioContext) {
		super();
		this.port = { onmessage: null, postMessage: (message) => {
			if (message.type === 'start-capture') {
				this.emit({ type: 'capture-armed', startFrame: message.startFrame });
			}
		}, start() {} };
		context.capture = this;
	}

	emit(data: Readonly<Record<string, unknown>>): void {
		this.port.onmessage?.({ data });
	}
}
