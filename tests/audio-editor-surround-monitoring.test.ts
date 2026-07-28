/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	connectSurroundMonitoring,
	configureNativeSurroundDestination,
	downmixSurroundToStereo,
} from '../src/common/editor/surround-monitoring.ts';

test('native surround monitoring configures a capable discrete destination', () => {
	const destination = {
		maxChannelCount: 8,
		channelCount: 2,
		channelCountMode: 'max',
		channelInterpretation: 'speakers',
	};
	assert.equal(configureNativeSurroundDestination(destination, 6), true);
	assert.deepEqual(destination, {
		maxChannelCount: 8,
		channelCount: 6,
		channelCountMode: 'explicit',
		channelInterpretation: 'discrete',
	});
	assert.equal(configureNativeSurroundDestination({ maxChannelCount: 2 }, 6), false);
});

test('unsupported surround devices receive the deterministic Web Audio downmix graph', () => {
	class Node {
		readonly connections: Array<{ node: Node; output: number; input: number }> = [];
		connect(node: Node, output = 0, input = 0) {
			this.connections.push({ node, output, input });
			return node;
		}
	}
	const source = new Node();
	const destination = Object.assign(new Node(), { maxChannelCount: 2 });
	const nodes: Node[] = [];
	const context = {
		currentTime: 0,
		destination,
		createChannelSplitter: () => new Node(),
		createChannelMerger: () => new Node(),
		createGain: () => Object.assign(new Node(), {
			gain: { value: 1, setValueAtTime(value: number) { this.value = value; } },
		}),
	};
	assert.equal(connectSurroundMonitoring(
		context as unknown as BaseAudioContext,
		source as unknown as AudioNode,
		destination as unknown as AudioNode,
		6,
		nodes as unknown as AudioNode[],
	), 'stereo-fallback');
	assert.equal(nodes.length, 8, 'one splitter, one merger, and six gain routes');
	assert.deepEqual(nodes[0].connections.map(({ output }) => output), [0, 1, 2, 2, 4, 5]);
	assert.deepEqual(nodes.slice(2).map((node) => node.connections[0].input), [0, 1, 0, 1, 0, 1]);
});

test('non-5.1 multichannel monitoring negotiates native output or falls back to the first stereo pair', () => {
	class Node {
		readonly connections: Array<{ node: Node; output: number; input: number }> = [];
		connect(node: Node, output = 0, input = 0) {
			this.connections.push({ node, output, input });
			return node;
		}
	}
	const nativeSource = new Node();
	const nativeDestination = Object.assign(new Node(), { maxChannelCount: 16, channelCount: 2 });
	const nativeContext = { destination: nativeDestination };
	assert.equal(connectSurroundMonitoring(
		nativeContext as unknown as BaseAudioContext,
		nativeSource as unknown as AudioNode,
		nativeDestination as unknown as AudioNode,
		8,
		[],
	), 'native');
	assert.equal(nativeDestination.channelCount, 8);

	const source = new Node();
	const destination = Object.assign(new Node(), { maxChannelCount: 2 });
	const nodes: Node[] = [];
	const context = {
		currentTime: 0,
		destination,
		createChannelSplitter: () => new Node(),
		createChannelMerger: () => new Node(),
		createGain: () => Object.assign(new Node(), {
			gain: { value: 1, setValueAtTime(value: number) { this.value = value; } },
		}),
	};
	assert.equal(connectSurroundMonitoring(
		context as unknown as BaseAudioContext,
		source as unknown as AudioNode,
		destination as unknown as AudioNode,
		4,
		nodes as unknown as AudioNode[],
	), 'stereo-fallback');
	assert.equal(nodes.length, 4, 'one splitter, one merger, and the first left/right pair');
	assert.deepEqual(nodes[0].connections.map(({ output }) => output), [0, 1]);
});

test('5.1 fallback monitoring omits LFE and applies normalized centre and surround gains', () => {
	const channels = [1, 2, 3, 99, 4, 5].map((value) => Float32Array.of(value, -value));
	const [left, right] = downmixSurroundToStereo(channels);
	const surroundGain = Math.SQRT1_2 * 0.5;
	assert.ok(Math.abs(left[0] - (0.5 + 3 * surroundGain + 4 * surroundGain)) < 1e-6);
	assert.ok(Math.abs(right[0] - (1 + 3 * surroundGain + 5 * surroundGain)) < 1e-6);
	assert.equal(left[1], -left[0]);
	assert.equal(right[1], -right[0]);
});

test('mono and stereo fallback monitoring retain their conventional mappings', () => {
	const mono = Float32Array.of(0.25, -0.5);
	assert.deepEqual(downmixSurroundToStereo([mono]).map((channel) => [...channel]), [[0.25, -0.5], [0.25, -0.5]]);
	const stereo = [Float32Array.of(1), Float32Array.of(2)];
	assert.deepEqual(downmixSurroundToStereo(stereo).map((channel) => [...channel]), [[1], [2]]);
});
