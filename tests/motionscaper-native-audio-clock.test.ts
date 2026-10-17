/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { renderProductNativeAudioToSink } from '../src/common/editor/controller/composition/product-native-render-audio-stream.ts';
import { MotionNativeCaptureNode, MotionNativeClockContext, motionNativeClockSample } from './helpers/motionscaper-native-clock-fixture.ts';

test('Motion native PCM preserves every sample without a sink-driven suspend/resume boundary', async () => {
	await withClock('sink-suspension', async context => {
		const samples: number[][] = [[], []];
		const result = await renderNative(4800, async channels => {
			await new Promise<void>(resolve => setImmediate(resolve));
			for (const [channel, values] of channels.entries()) samples[channel]!.push(...values);
		});
		assert.deepEqual(result, { sampleRate: 48000, channelCount: 2, frameCount: 4800, chunkCount: 2 });
		for (let channel = 0; channel < 2; channel++) {
			assert.deepEqual(samples[channel], Array.from({ length: 4800 }, (_, frame) => motionNativeClockSample(frame, channel)));
		}
		assert.equal(context.suspendCalls, 1, 'only initial graph setup may suspend the exact delivery clock');
		assert.equal(context.closeCalls, 1);
		assert.ok(context.maximumInFlightChunks <= 2, 'the existing two-packet producer bound stays in force');
	});
});

test('Motion native PCM still refuses a genuinely missing running render quantum', async () => {
	await withClock('running-quantum', async context => {
		await assert.rejects(renderNative(4800, () => undefined), { code: 'REALTIME_CAPTURE_CLOCK_GAP' });
		assert.equal(context.closeCalls, 1);
	});
});

test('Motion native PCM still refuses a sink that exceeds its two-packet bound', async () => {
	await withClock('none', async context => {
		let release!: () => void;
		const blocked = new Promise<void>(resolve => { release = resolve; });
		context.onClose = release;
		context.onSinkSuspension = release;
		await assert.rejects(renderNative(12288, async () => { await blocked; }), { code: 'REALTIME_CAPTURE_BACKPRESSURE' });
		assert.equal(context.closeCalls, 1);
		assert.equal(context.maximumInFlightChunks, 2);
	});
});

function renderNative(frames: number, sink: (channels: readonly Float32Array[]) => Promise<void> | void) {
	return renderProductNativeAudioToSink({
		signal: new AbortController().signal, sourceBuffers: new Map<string, AudioBuffer>(),
		assertCurrent() {}, async prepareCommittedTimePitchCaches() {}, createRenderEngine: createAudioEditorEngine,
	}, {
		sampleRate: 48000, masterChannels: 2, tracks: [], clips: [],
		master: { gain: 1, pan: 0, mute: false, effects: [] },
	}, { outputFrames: frames }, sink);
}

async function withClock(fault: MotionNativeClockContext['fault'], run: (context: MotionNativeClockContext) => Promise<void>) {
	const context = new MotionNativeClockContext(fault);
	const previousContext = globalThis.AudioContext, previousWorklet = globalThis.AudioWorkletNode;
	globalThis.AudioContext = function ContextFactory() { return context; } as unknown as typeof AudioContext;
	globalThis.AudioWorkletNode = MotionNativeCaptureNode as unknown as typeof AudioWorkletNode;
	try { await run(context); }
	finally {
		await context.close();
		context.restore();
		if (previousContext === undefined) Reflect.deleteProperty(globalThis, 'AudioContext');
		else globalThis.AudioContext = previousContext;
		if (previousWorklet === undefined) Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
		else globalThis.AudioWorkletNode = previousWorklet;
	}
}
