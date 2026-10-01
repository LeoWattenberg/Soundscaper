/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { waitForRealtimeCaptureReady } from '../src/common/editor/engine/realtime-capture-ready.ts';

test('the renderer freezes automatic startup and waits for the audio thread before scheduling', async () => {
	await withReadyRender(async ({ context, capture, rendering }) => {
		assert.equal(context.state, 'suspended', 'construction can queue an automatic start while reporting suspended');
		assert.equal(context.resumeCalls, 0);
		assert.equal(capture.startCalls, 0);
		capture.emit({ type: 'capture-ready' });
		await capture.startRequested;
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(context.resumeCalls, 0, 'the scheduled clock stays frozen until the audio thread arms capture');
		capture.arm();
		await rendering;
		assert.equal(capture.startCalls, 1);
		assert.equal(context.resumeCalls, 1);
	});
});

test('cancellation in the same turn as capture arming never resumes the audio clock', async () => {
	await withReadyRender(async ({ context, capture, rendering, abort }) => {
		capture.emit({ type: 'capture-ready' });
		await capture.startRequested;
		capture.arm();
		abort.abort();
		await assert.rejects(rendering, { name: 'AbortError' });
		assert.equal(context.resumeCalls, 0);
		assert.equal(context.state, 'closed');
	});
});

for (const failure of ['cancellation', 'processor failure', 'timeout'] as const) {
	test(`capture arm ${failure} cleans up without resuming the scheduled clock`, async (testContext) => {
		if (failure === 'timeout') testContext.mock.timers.enable({ apis: ['setTimeout'] });
		await withReadyRender(async ({ context, capture, rendering, abort }) => {
			capture.emit({ type: 'capture-ready' });
			await capture.startRequested;
			if (failure === 'cancellation') abort.abort();
			else if (failure === 'processor failure') capture.onprocessorerror?.();
			else testContext.mock.timers.tick(10_000);
			await assert.rejects(rendering, failure === 'cancellation'
				? { name: 'AbortError' }
				: failure === 'processor failure' ? /worklet failed/u : /did not arm/u);
			assert.equal(context.resumeCalls, 0);
			assert.equal(context.state, 'closed');
			assert.equal(capture.port.onmessage, null);
		});
	});
}

test('realtime capture setup waits for the suspended worklet to initialize before scheduling', async () => {
	const capture = captureNode();
	let ready = false;
	const waiting = waitForRealtimeCaptureReady(capture).then(() => { ready = true; });
	await Promise.resolve();
	assert.equal(ready, false);
	capture.port.onmessage?.({ data: { type: 'unrelated' } } as MessageEvent);
	await Promise.resolve();
	assert.equal(ready, false);
	capture.port.onmessage?.({ data: { type: 'capture-ready' } } as MessageEvent);
	await waiting;
	assert.equal(ready, true);
	assert.equal(capture.port.onmessage, null);
	assert.equal(capture.onprocessorerror, null);
});

test('cancellation rejects worklet initialization without waiting for a ready message', async () => {
	const capture = captureNode();
	const abort = new AbortController();
	const waiting = waitForRealtimeCaptureReady(capture, abort.signal);
	abort.abort();
	await assert.rejects(waiting, { name: 'AbortError' });
	assert.equal(capture.port.onmessage, null);
});

test('worklet initialization reports a processor failure before rendering starts', async () => {
	const capture = captureNode();
	const waiting = waitForRealtimeCaptureReady(capture);
	capture.onprocessorerror?.call(capture as AudioWorkletNode, new Event('processorerror') as ErrorEvent);
	await assert.rejects(waiting, /worklet failed/u);
});

test('worklet initialization times out without leaving its event handlers installed', async (context) => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const capture = captureNode();
	const waiting = assert.rejects(waitForRealtimeCaptureReady(capture), /did not initialize/u);
	context.mock.timers.tick(10_000);
	await waiting;
	assert.equal(capture.port.onmessage, null);
	assert.equal(capture.onprocessorerror, null);
});

test('an already cancelled render never installs initialization handlers', async () => {
	const capture = captureNode();
	const abort = new AbortController();
	abort.abort();
	await assert.rejects(waitForRealtimeCaptureReady(capture, abort.signal), { name: 'AbortError' });
	assert.equal(capture.port.onmessage, null);
});

async function withReadyRender(run: (fixture: {
	context: ReadyContext;
	capture: ReadyCapture;
	rendering: ReturnType<ReturnType<typeof createAudioEditorEngine>['renderMixRealtime']>;
	abort: AbortController;
}) => Promise<void>): Promise<void> {
	const previousContext = globalThis.AudioContext;
	const previousWorklet = globalThis.AudioWorkletNode;
	const context = new ReadyContext();
	let nodeCreated!: (capture: ReadyCapture) => void;
	const created = new Promise<ReadyCapture>((resolve) => { nodeCreated = resolve; });
	globalThis.AudioContext = function ContextFactory() { return context; } as unknown as typeof AudioContext;
	globalThis.AudioWorkletNode = class extends ReadyCapture {
		constructor() { super(context); nodeCreated(this); }
	} as unknown as typeof AudioWorkletNode;
	const engine = createAudioEditorEngine();
	const abort = new AbortController();
	try {
		engine.loadProject({ sampleRate: 48_000, masterChannels: 1, tracks: [], clips: [],
			master: { gain: 1, pan: 0, mute: false, effects: [] } });
		const rendering = engine.renderMixRealtime({ outputFrames: 1, onChunk: () => undefined, signal: abort.signal });
		void rendering.catch(() => undefined);
		await run({ context, capture: await created, rendering, abort });
	} finally {
		abort.abort();
		await engine.dispose();
		if (previousContext === undefined) Reflect.deleteProperty(globalThis, 'AudioContext');
		else globalThis.AudioContext = previousContext;
		if (previousWorklet === undefined) Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
		else globalThis.AudioWorkletNode = previousWorklet;
	}
}

function captureNode(): Pick<AudioWorkletNode, 'port' | 'onprocessorerror'> {
	return { port: { onmessage: null, start() {} } as MessagePort, onprocessorerror: null };
}

class ReadyNode {
	readonly gain = { value: 1, setValueAtTime() {} };
	connect(target: unknown): unknown { return target; }
	disconnect(): void {}
}

class ReadyContext {
	readonly sampleRate = 48_000;
	readonly currentTime = 0;
	readonly destination = new ReadyNode();
	readonly audioWorklet = { addModule: async () => { if (this.suspendCalls === 0) this.state = 'running'; } };
	state: AudioContextState = 'suspended';
	capture: ReadyCapture | null = null;
	resumeCalls = 0;
	suspendCalls = 0;
	async suspend(): Promise<void> { this.suspendCalls += 1; this.state = 'suspended'; }
	createGain(): ReadyNode { return new ReadyNode(); }
	async resume(): Promise<void> {
		this.resumeCalls += 1;
		this.state = 'running';
		this.capture?.emit({ type: 'audio-chunk', frameOffset: 0, frames: 1, channels: [Float32Array.of(0.5)] });
		this.capture?.emit({ type: 'done', frames: 1 });
	}
	async close(): Promise<void> { this.state = 'closed'; }
}

class ReadyCapture extends ReadyNode {
	readonly port = {
		onmessage: null as ((event: { data: Readonly<Record<string, unknown>> }) => void) | null,
		start() {},
		postMessage: (message: Readonly<Record<string, unknown>>): void => {
			if (message.type !== 'start-capture') return;
			this.startCalls += 1;
			this.startFrame = message.startFrame;
			this.resolveStartRequested();
		},
	};
	onprocessorerror: (() => void) | null = null;
	startCalls = 0;
	private startFrame: unknown;
	private resolveStartRequested!: () => void;
	readonly startRequested = new Promise<void>((resolve) => { this.resolveStartRequested = resolve; });
	arm(): void { this.emit({ type: 'capture-armed', startFrame: this.startFrame }); }
	constructor(context: ReadyContext) { super(); context.capture = this; }
	emit(data: Readonly<Record<string, unknown>>): void { this.port.onmessage?.({ data }); }
}
