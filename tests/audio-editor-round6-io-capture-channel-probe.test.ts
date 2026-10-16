/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { probeCaptureAudioInputChannelCount } from '../src/common/editor/capture-audio-input-channel-probe.ts';

function nativeGraph(width: number, failConstruction = false) {
	const descriptors = new Map(['AudioContext', 'AudioWorkletNode', 'MediaStream'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	const destination = {};
	const source = { connections: [] as unknown[], disconnects: 0,
		connect(node: unknown) { this.connections.push(node); }, disconnect() { this.disconnects += 1; } };
	const nodes: FakeNode[] = [];
	class FakeStream { stopCalls = 0; }
	class FakeContext {
		state = 'suspended'; resumeCalls = 0; modules: string[] = []; destination = destination;
		audioWorklet = { addModule: async (url: string) => { this.modules.push(url); } };
		async resume() { this.state = 'running'; this.resumeCalls += 1; }
		createMediaStreamSource(stream: unknown) { assert.ok(stream instanceof FakeStream); return source; }
	}
	class FakeNode {
		disconnects = 0; onprocessorerror: (() => void) | null = null;
		port = { onmessage: null as ((event: MessageEvent<unknown>) => void) | null, closed: 0,
			postMessage(message: unknown) { assert.deepEqual(message, { type: 'inspect-input-channel-count' }); },
			close() { this.closed += 1; } };
		constructor(context: unknown, name: string, options: unknown) {
			assert.ok(context instanceof FakeContext);
			assert.equal(name, 'kw-audio-recorder');
			assert.deepEqual(options, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
				channelCountMode: 'max', channelInterpretation: 'discrete', processorOptions: { monitor: false } });
			if (failConstruction) throw new Error('Node unavailable');
			nodes.push(this);
		}
		connect(target: unknown) {
			assert.equal(target, destination);
			queueMicrotask(() => { this.port.onmessage?.(new MessageEvent('message', { data: { type: 'input-channel-count', channelCount: width } })); });
		}
		disconnect() { this.disconnects += 1; }
	}
	const constructors: ReadonlyArray<readonly [string, unknown]> = [['AudioContext', FakeContext], ['AudioWorkletNode', FakeNode], ['MediaStream', FakeStream]];
	for (const [key, value] of constructors) {
		Object.defineProperty(globalThis, key, { value, configurable: true });
	}
	return { context: new FakeContext(), stream: new FakeStream(), source, nodes, restore() {
		for (const [key, descriptor] of descriptors) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	} };
}

test('native input inspection retains the observed stereo width and releases its silent graph', async () => {
	const graph = nativeGraph(2);
	try {
		assert.equal(await probeCaptureAudioInputChannelCount(graph.context, graph.stream), 2);
		assert.equal(graph.context.resumeCalls, 1);
		assert.equal(graph.context.modules.length, 1);
		assert.equal(graph.source.disconnects, 1);
		assert.equal(graph.nodes[0]?.disconnects, 1);
		assert.equal(graph.nodes[0]?.port.closed, 1);
		assert.equal(graph.nodes[0]?.port.onmessage, null);
		assert.equal(graph.stream.stopCalls, 0);
	} finally { graph.restore(); }
});

test('invalid native input observations are refused with graph cleanup', async () => {
	const graph = nativeGraph(0);
	try {
		await assert.rejects(probeCaptureAudioInputChannelCount(graph.context, graph.stream), /observed channel count/iu);
		assert.equal(graph.source.disconnects, 1);
		assert.equal(graph.nodes[0]?.port.closed, 1);
		assert.equal(graph.stream.stopCalls, 0);
	} finally { graph.restore(); }
});

test('worklet creation failure releases the connected source without stopping its owned track', async () => {
	const graph = nativeGraph(2, true);
	try {
		await assert.rejects(probeCaptureAudioInputChannelCount(graph.context, graph.stream), /Node unavailable/u);
		assert.equal(graph.source.disconnects, 1);
		assert.equal(graph.stream.stopCalls, 0);
	} finally { graph.restore(); }
});
