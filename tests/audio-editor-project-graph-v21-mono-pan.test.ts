/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProjectGraphV21 } from '../src/common/editor/engine/project-graph-v21.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';

class FakeParam {
	value: number;

	constructor(value = 0) { this.value = value; }

	setValueAtTime(value: number): AudioParam {
		this.value = value;
		return this as unknown as AudioParam;
	}

	linearRampToValueAtTime(value: number): AudioParam {
		this.value = value;
		return this as unknown as AudioParam;
	}

	cancelScheduledValues(): AudioParam { return this as unknown as AudioParam; }
}

interface FakeConnection {
	readonly target: FakeNode;
	readonly output?: number;
	readonly input?: number;
}

class FakeNode {
	readonly kind: string;
	readonly connections: FakeConnection[] = [];

	constructor(kind: string) { this.kind = kind; }

	connect(target: FakeNode, output?: number, input?: number): FakeNode {
		this.connections.push({ target, ...(output === undefined ? {} : { output, input }) });
		return target;
	}

	disconnect(): void { this.connections.length = 0; }
}

type FakeCreated = FakeNode & Record<string, unknown>;

class FakeContext {
	readonly sampleRate = 48_000;
	readonly currentTime = 0;
	readonly destination = new FakeNode('destination');
	readonly created: FakeCreated[] = [];
	#counters = new Map<string, number>();

	createGain(): FakeCreated { return this.#make('gain', { gain: new FakeParam(1) }); }
	createStereoPanner(): FakeCreated { return this.#make('panner', { pan: new FakeParam(0) }); }
	createDelay(): FakeCreated { return this.#make('delay', { delayTime: new FakeParam(0) }); }
	createChannelSplitter(channels: number): FakeCreated { return this.#make('splitter', { channels }); }
	createChannelMerger(channels: number): FakeCreated { return this.#make('merger', { channels }); }
	createAnalyser(): FakeCreated {
		return this.#make('analyser', {
			fftSize: 256,
			smoothingTimeConstant: 0,
			getFloatTimeDomainData(target: Float32Array) { target.fill(0); },
		});
	}

	#make(kind: string, fields: Record<string, unknown>): FakeCreated {
		const index = (this.#counters.get(kind) ?? 0) + 1;
		this.#counters.set(kind, index);
		const node = Object.assign(new FakeNode(`${kind}-${String(index)}`), fields);
		this.created.push(node);
		return node;
	}
}

/**
 * Which of the panner's two output channels each downstream node carries.
 *
 * A plain connection passes every channel through by position; an explicit
 * connection (a splitter output, a merger input) moves one channel to one index.
 */
function pannerChannelsByNode(panner: FakeNode): Map<FakeNode, Map<number, Set<number>>> {
	const carried = new Map<FakeNode, Map<number, Set<number>>>();
	carried.set(panner, new Map([[0, new Set([0])], [1, new Set([1])]]));
	const queue: FakeNode[] = [panner];
	while (queue.length) {
		const node = queue.shift()!;
		const source = carried.get(node)!;
		for (const connection of node.connections) {
			const next = carried.get(connection.target) ?? new Map<number, Set<number>>();
			let changed = false;
			const deliver = (channel: number, values: Iterable<number>): void => {
				const present = next.get(channel) ?? new Set<number>();
				if (!next.has(channel)) next.set(channel, present);
				for (const value of values) {
					if (present.has(value)) continue;
					present.add(value);
					changed = true;
				}
			};
			if (connection.output === undefined) for (const [channel, values] of source) deliver(channel, values);
			else deliver(connection.input ?? 0, source.get(connection.output) ?? []);
			carried.set(connection.target, next);
			if (changed) queue.push(connection.target);
		}
	}
	return carried;
}

function monoPanProject(): EngineProject {
	const edge = (
		id: string,
		kind: 'assignment' | 'send',
		source: Record<string, unknown>,
		destination: Record<string, unknown>,
		position: 'pre-fader' | 'post-fader',
		channelMap: readonly number[],
	) => ({ id, kind, source, destination, position, level: 1, enabled: true, channelMap });
	return {
		schemaFamily: 'soundscaper', schemaVersion: 1,
		sampleRate: 48_000,
		masterChannels: 2,
		sources: [{ id: 'voice-source', channelCount: 1 }],
		clips: [{ id: 'voice-clip', sourceId: 'voice-source' }],
		tracks: [{
			type: 'audio', id: 'voice', clipIds: ['voice-clip'], gain: 1, pan: 1,
			mute: false, solo: false, effectsActive: true, effects: [],
		}],
		master: { gain: 1, pan: 0, mute: false, solo: false, effectsActive: true, effects: [] },
		mixer: {
			schemaVersion: 1,
			groups: [],
			sends: [],
			cues: [{
				id: 'cue', name: 'Cue', color: '', gain: 1, pan: 0, mute: false, solo: false,
				collapsed: false, effectsActive: true, effects: [], channelCount: 2,
			}],
			vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }],
			edges: [
				edge('assignment:track:voice:master', 'assignment', { kind: 'track', id: 'voice' },
					{ kind: 'master' }, 'post-fader', [0, 0]),
				edge('send:track:voice:cue', 'send', { kind: 'track', id: 'voice' },
					{ kind: 'mixer-node', id: 'cue' }, 'pre-fader', [0, 0]),
				edge('assignment:master:output:main', 'assignment', { kind: 'master' },
					{ kind: 'output', id: 'main' }, 'post-fader', [0, 1]),
			],
		},
		automationLanes: [],
	} as unknown as EngineProject;
}

test('a panned mono track carries both panner channels to the master', () => {
	const context = new FakeContext();
	const graph = buildProjectGraphV21(
		context as unknown as BaseAudioContext,
		context.destination as unknown as AudioNode,
		monoPanProject(),
	);
	const panner = context.created.find((node) => node.kind.startsWith('panner-'));
	assert.ok(panner, 'the mono track still gets a stereo panner');
	assert.equal((panner.pan as FakeParam).value, 1);

	const carried = pannerChannelsByNode(panner);
	const narrowed = [...carried.keys()].filter((node) => (
		node.kind.startsWith('splitter-') && (node as FakeCreated).channels === 1
	));
	assert.deepEqual(narrowed.map((node) => node.kind), [],
		'no one-channel splitter may sit on the panner output and discard its right channel');

	const master = graph.productionStripAnalysersV21?.get('master');
	assert.ok(master);
	const atMaster = carried.get(master.output as unknown as FakeNode);
	assert.ok(atMaster, 'the panned track reaches the master strip');
	assert.deepEqual([...(atMaster.get(0) ?? [])], [0], 'master left carries the panner left channel');
	assert.deepEqual([...(atMaster.get(1) ?? [])], [1], 'master right carries the panner right channel');

	const bank = graph.productionStripAnalysersV21?.get('track:voice');
	assert.ok(bank);
	assert.deepEqual(bank.channelLabels, ['L', 'R']);
	assert.equal(bank.analysers.length, 2);
});

test('a pre-fader send still spreads the mono strip across its stereo destination', () => {
	const context = new FakeContext();
	buildProjectGraphV21(
		context as unknown as BaseAudioContext,
		context.destination as unknown as AudioNode,
		monoPanProject(),
	);
	const narrow = context.created.filter((node) => node.kind.startsWith('splitter-') && node.channels === 1);
	assert.equal(narrow.length, 1, 'only the pre-fader send reads the strip at its declared mono width');
	const merger = context.created.find((node) => node.kind.startsWith('merger-'));
	assert.ok(merger);
	assert.deepEqual(narrow[0]!.connections.map(({ target, output, input }) => (
		[target === merger, output, input]
	)), [[true, 0, 0], [true, 0, 1]]);
});
