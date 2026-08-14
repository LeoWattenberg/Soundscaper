/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DynamicsProcessor } from '../src/common/editor/dynamics-worklet.js';
import { ensureProjectWorklets } from '../src/common/editor/engine/effect-worklets.ts';
import { scheduleProjectClips } from '../src/common/editor/engine/clip-scheduler.ts';
import { buildProjectGraph, projectGraphLatencyFrames } from '../src/common/editor/engine/project-graph.ts';
import { createStripMeterAnalyserBankV21 } from '../src/common/editor/engine/strip-meter-analyser-bank-v21.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';

type ParamCall = readonly ['set' | 'linear' | 'cancel', number, number?];

class FakeParam {
	value: number;
	readonly calls: ParamCall[] = [];

	constructor(value = 0) { this.value = value; }

	setValueAtTime(value: number, time: number): AudioParam {
		this.value = value;
		this.calls.push(['set', value, time]);
		return this as unknown as AudioParam;
	}

	linearRampToValueAtTime(value: number, time: number): AudioParam {
		this.value = value;
		this.calls.push(['linear', value, time]);
		return this as unknown as AudioParam;
	}

	cancelScheduledValues(time: number): AudioParam {
		this.calls.push(['cancel', time]);
		return this as unknown as AudioParam;
	}
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

class FakeContext {
	readonly sampleRate = 48_000;
	readonly currentTime = 0;
	readonly destination = new FakeNode('destination');
	readonly created: Array<FakeNode & Record<string, unknown>> = [];
	readonly audioWorklet = { addModule: async (): Promise<void> => undefined };
	#counters = new Map<string, number>();

	createGain() { return this.#make('gain', { gain: new FakeParam(1) }); }
	createStereoPanner() { return this.#make('panner', { pan: new FakeParam(0) }); }
	createDelay() { return this.#make('delay', { delayTime: new FakeParam(0) }); }
	createChannelSplitter(channels: number) { return this.#make('splitter', { channels }); }
	createChannelMerger(channels: number) { return this.#make('merger', { channels }); }
	createAnalyser() {
		return this.#make('analyser', {
			fftSize: 256,
			smoothingTimeConstant: 0,
			getFloatTimeDomainData(target: Float32Array) { target.fill(0); },
		});
	}
	createBiquadFilter() {
		return this.#make('biquad', {
			type: 'highpass', frequency: new FakeParam(), Q: new FakeParam(), gain: new FakeParam(),
		});
	}

	#make(kind: string, fields: Record<string, unknown>): FakeNode & Record<string, unknown> {
		const index = (this.#counters.get(kind) ?? 0) + 1;
		this.#counters.set(kind, index);
		const node = Object.assign(new FakeNode(`${kind}-${String(index)}`), fields);
		this.created.push(node);
		return node;
	}
}

class FakeWorkletNode extends FakeNode {
	readonly options: AudioWorkletNodeOptions;
	readonly port = {
		postMessage(): void {},
		start(): void {},
		onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
	};

	constructor(_context: BaseAudioContext, name: string, options: AudioWorkletNodeOptions = {}) {
		super(`worklet:${name}`);
		this.options = options;
	}
}

test('the dynamics worklet consumes its explicit second input only as the detector', () => {
	const runtimeGlobal = globalThis as typeof globalThis & { sampleRate?: number };
	const previousSampleRate = runtimeGlobal.sampleRate;
	runtimeGlobal.sampleRate = 48_000;
	try {
		const gate = new DynamicsProcessor({
			processorOptions: {
				type: 'gate',
				params: { threshold: -20, attack: 0, hold: 0, release: 0, rangeDb: -80 },
			},
		});
		const program = new Float32Array(8).fill(0.5);
		const quietDetector = new Float32Array(8);
		const closed = [new Float32Array(8)];
		gate.process([[program], [quietDetector]], [closed]);
		assert.ok(Math.max(...closed[0]!.map(Math.abs)) < 0.0001);
		const loudDetector = new Float32Array(8).fill(1);
		const open = [new Float32Array(8)];
		gate.process([[program], [loudDetector]], [open]);
		assert.ok(open[0]!.every((value) => Math.abs(value - 0.5) < 1e-6));
	} finally {
		if (previousSampleRate === undefined) delete runtimeGlobal.sampleRate;
		else runtimeGlobal.sampleRate = previousSampleRate;
	}
});

test('production strip analysers preserve channel geometry and expose one analyser per channel', () => {
	const context = new FakeContext();
	const nodes: AudioNode[] = [];
	const input = new FakeNode('input');
	const bank = createStripMeterAnalyserBankV21(
		context as unknown as BaseAudioContext,
		nodes,
		input as unknown as AudioNode,
		{ kind: 'track', id: 'surround' },
		6,
	);
	assert.ok(bank);
	assert.deepEqual(bank.channelLabels, ['L', 'R', 'C', 'LFE', 'Ls', 'Rs']);
	assert.equal(bank.analysers.length, 6);
	const splitter = context.created.find((node) => node.kind.startsWith('splitter-'));
	const merger = context.created.find((node) => node.kind.startsWith('merger-'));
	assert.ok(splitter && merger);
	assert.equal(input.connections[0]?.target, splitter);
	assert.deepEqual(splitter.connections.map(({ output, input: targetInput }) => [output, targetInput]), [
		[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0],
	]);
	for (const [index, analyser] of bank.analysers.entries()) {
		const fake = analyser as unknown as FakeNode;
		assert.deepEqual(fake.connections, [{ target: merger, output: 0, input: index }]);
	}
});

test('V21 empty tracks inherit the master width used by their default channel maps', () => {
	const context = new FakeContext();
	const channels = [0, 1, 2, 3, 4, 5];
	const project = {
		schemaVersion: 21,
		sampleRate: 48_000,
		masterChannels: 6,
		tracks: [{
			type: 'audio', id: 'empty', clipIds: [], gain: 1, pan: 0,
			mute: false, solo: false, effectsActive: true, effects: [],
		}],
		master: { gain: 1, pan: 0, mute: false, solo: false, effectsActive: true, effects: [] },
		mixer: {
			schemaVersion: 1,
			groups: [], sends: [], cues: [], vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 6 }],
			edges: [
				{
					id: 'assignment:track:empty:master', kind: 'assignment',
					source: { kind: 'track', id: 'empty' }, destination: { kind: 'master' },
					position: 'post-fader', level: 1, enabled: true, channelMap: channels,
				},
				{
					id: 'assignment:master:output:main', kind: 'assignment',
					source: { kind: 'master' }, destination: { kind: 'output', id: 'main' },
					position: 'post-fader', level: 1, enabled: true, channelMap: channels,
				},
			],
		},
		automationLanes: [],
	} as EngineProject;
	assert.doesNotThrow(() => buildProjectGraph(
		context as unknown as BaseAudioContext,
		context.destination as unknown as AudioNode,
		project,
		{ metering: false },
	));
});

test('V21 builds explicit nested routes, per-edge PDC, channel maps, VCA control, and main output only', async () => {
	const previous = globalThis.AudioWorkletNode;
	Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: FakeWorkletNode });
	try {
		const context = new FakeContext();
		const project = productionProjectV21();
		await ensureProjectWorklets(context as unknown as BaseAudioContext, project);
		const graph = buildProjectGraph(
			context as unknown as BaseAudioContext,
			context.destination as unknown as AudioNode,
			project,
			{ metering: false },
		);

		assert.equal(graph.pathPdcPlanV21?.pdcErrorSamples, 0);
		assert.equal(graph.latencyFrames, 720);
		assert.equal(projectGraphLatencyFrames(project), 720);
		assert.equal(graph.pathPdcPlanV21?.edgeCompensationFrames.get('dry-to-child'), 480);
		assert.equal(graph.pathPdcPlanV21?.edgeCompensationFrames.get('dry-sidechain-child'), 480);
		assert.ok(context.created.some((node) => (
			node.kind.startsWith('delay-')
			&& (node.delayTime as FakeParam).calls.some((call) => call[0] === 'set' && call[1] === 0.01)
		)));

		const splitter = context.created.find((node) => node.kind.startsWith('splitter-'));
		const merger = context.created.find((node) => node.kind.startsWith('merger-'));
		assert.ok(splitter && merger);
		assert.deepEqual(splitter.connections.filter(({ target }) => target === merger), [
			{ target: merger, output: 1, input: 0 },
			{ target: merger, output: 0, input: 1 },
		]);

		const dryGain = graph.parameterRegistry.get({
			kind: 'strip', strip: { kind: 'track', id: 'dry' }, parameterId: 'gain',
		});
		assert.ok(dryGain && dryGain.binding.kind === 'audio-param');
		if (dryGain.binding.kind === 'audio-param') {
			assert.equal((dryGain.binding.params[0]!.param as unknown as FakeParam).value, 0.8);
		}
		assert.ok(context.created.some((node) => node.gain instanceof FakeParam && node.gain.value === 0.5));
		assert.equal(graph.parameterRegistry.get({
			kind: 'edge', edgeId: 'dry-to-child', parameterId: 'level',
		})?.latencyFrames, 480);
		assert.equal(graph.parameterRegistry.get({
			kind: 'effect', strip: { kind: 'mixer-node', id: 'parent' },
			effectId: 'parent-filter', parameterId: 'frequency',
		})?.latencyFrames, 720);

		const dynamics = graph.nodes.find((node) => (
			(node as unknown as FakeNode).kind === 'worklet:kw-audio-dynamics'
			&& (node as unknown as FakeWorkletNode).options.numberOfInputs === 2
		)) as unknown as FakeWorkletNode;
		assert.equal(dynamics.options.numberOfInputs, 2);
		assert.ok(graph.nodes.some((node) => (node as unknown as FakeNode).connections.some((connection) => (
			connection.target === dynamics && connection.input === 1
		))));
		assert.equal(context.destination.connections.length, 0);
		assert.equal(graph.nodes.filter((node) => (node as unknown as FakeNode).connections.some(({ target }) => (
			target === context.destination
		))).length, 1);
	} finally {
		Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: previous });
	}
});

test('V21 applies sidechain-induced PDC before a track effect rack', async () => {
	const previous = globalThis.AudioWorkletNode;
	Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: FakeWorkletNode });
	try {
		const context = new FakeContext();
		const project = trackSidechainProjectV21();
		await ensureProjectWorklets(context as unknown as BaseAudioContext, project);
		const graph = buildProjectGraph(
			context as unknown as BaseAudioContext,
			context.destination as unknown as AudioNode,
			project,
			{ metering: false },
		);

		assert.equal(graph.pathPdcPlanV21?.nodeInputLatencyFrames.get('track:program'), 7);
		const programInput = graph.trackInputs.get('program') as unknown as FakeNode;
		const inputDelay = programInput.connections[0]?.target as (FakeNode & { delayTime?: FakeParam }) | undefined;
		assert.ok(inputDelay?.kind.startsWith('delay-'));
		if (!inputDelay) throw new Error('The program track input PDC delay was not created.');
		assert.ok(inputDelay.delayTime?.calls.some((call) => (
			call[0] === 'set' && Math.abs(call[1] - (7 / 48_000)) < Number.EPSILON
		)));
		assert.ok(inputDelay.connections.some(({ target }) => target.kind === 'worklet:kw-audio-dynamics'));
	} finally {
		Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: previous });
	}
});

test('V21 schedules every automation lane once for a playback or render window with path latency applied once', async () => {
	const previous = globalThis.AudioWorkletNode;
	Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: FakeWorkletNode });
	try {
		const context = new FakeContext();
		const project = productionProjectV21();
		await ensureProjectWorklets(context as unknown as BaseAudioContext, project);
		const graph = buildProjectGraph(
			context as unknown as BaseAudioContext,
			context.destination as unknown as AudioNode,
			project,
			{ metering: false },
		);
		const target = graph.parameterRegistry.get({
			kind: 'strip', strip: { kind: 'track', id: 'dry' }, parameterId: 'gain',
		});
		assert.ok(target && target.binding.kind === 'audio-param');
		if (target.binding.kind !== 'audio-param') return;
		const gain = target.binding.params[0]!.param as unknown as FakeParam;
		const before = gain.calls.length;

		await scheduleProjectClips({
			context: context as unknown as BaseAudioContext,
			project,
			sources: new Map(),
			trackInputs: graph.trackInputs,
			projectGainParams: graph.projectGainParams,
			parameterRegistry: graph.parameterRegistry,
			fromFrame: 0,
			toFrame: 48_000,
			contextStartTime: 2,
			sampleRate: 48_000,
			reversedBuffers: new WeakMap(),
			sourceResolver: null,
			activeSources: graph.sources,
			allNodes: graph.nodes,
		});

		assert.deepEqual(gain.calls.slice(before), [
			['cancel', 2],
			['set', 0.2, 2],
			['linear', 0.8, 3],
		]);
	} finally {
		Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: previous });
	}
});

function productionProjectV21(): EngineProject {
	const strip = (id: string, effects: readonly Record<string, unknown>[] = []) => ({
		id, name: id, color: '', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: false, effectsActive: true, effects, channelCount: 2,
	});
	const edge = (
		id: string,
		kind: 'assignment' | 'send' | 'sidechain',
		source: Record<string, unknown>,
		destination: Record<string, unknown>,
		position: 'pre-fader' | 'post-fader' = 'post-fader',
		channelMap: readonly number[] = [0, 1],
	) => ({ id, kind, source, destination, position, level: 1, enabled: true, channelMap });
	return {
		schemaVersion: 21,
		sampleRate: 48_000,
		masterChannels: 2,
		tracks: [
			{ type: 'audio', id: 'dry', gain: 0.8, pan: 0, mute: false, solo: false, effectsActive: true, effects: [] },
			{
				type: 'audio', id: 'late', gain: 1, pan: 0, mute: false, solo: false,
				effectsActive: true,
				effects: [{ id: 'track-limit', type: 'limiter', enabled: true, bypassed: false, params: { lookahead: 0.01 } }],
			},
		],
		master: { gain: 1, pan: 0, mute: false, solo: false, effectsActive: true, effects: [] },
		mixer: {
			schemaVersion: 1,
			groups: [
				strip('child', [{ id: 'child-gate', type: 'gate', enabled: true, bypassed: false, params: { threshold: -40 } }]),
				strip('parent', [
					{ id: 'parent-limit', type: 'limiter', enabled: true, bypassed: false, params: { lookahead: 0.005 } },
					{ id: 'parent-filter', type: 'highpass', enabled: true, bypassed: false, params: { frequency: 100 } },
				]),
			],
			sends: [],
			cues: [strip('cue')],
			vcas: [{ id: 'vca-1', name: 'VCA', gain: 0.5, mute: false, members: [{ kind: 'track', id: 'dry' }] }],
			outputs: [
				{ id: 'main', name: 'Main', role: 'main', channelCount: 2 },
				{ id: 'cue-out', name: 'Cue', role: 'cue', channelCount: 2 },
			],
			edges: [
				edge('dry-to-child', 'assignment', { kind: 'track', id: 'dry' }, { kind: 'mixer-node', id: 'child' }, 'post-fader', [1, 0]),
				edge('late-to-child', 'assignment', { kind: 'track', id: 'late' }, { kind: 'mixer-node', id: 'child' }),
				edge('dry-sidechain-child', 'sidechain', { kind: 'track', id: 'dry' }, {
					kind: 'effect-sidechain', strip: { kind: 'mixer-node', id: 'child' }, effectId: 'child-gate',
				}, 'pre-fader'),
				edge('child-to-parent', 'assignment', { kind: 'mixer-node', id: 'child' }, { kind: 'mixer-node', id: 'parent' }),
				edge('parent-to-master', 'assignment', { kind: 'mixer-node', id: 'parent' }, { kind: 'master' }),
				edge('master-to-main', 'assignment', { kind: 'master' }, { kind: 'output', id: 'main' }),
				edge('dry-to-cue', 'send', { kind: 'track', id: 'dry' }, { kind: 'mixer-node', id: 'cue' }, 'pre-fader'),
				edge('cue-to-output', 'assignment', { kind: 'mixer-node', id: 'cue' }, { kind: 'output', id: 'cue-out' }),
			],
		},
		automationLanes: [{
			id: 'dry-gain-lane',
			address: { kind: 'strip', strip: { kind: 'track', id: 'dry' }, parameterId: 'gain' },
			timebase: 'absolute-samples',
			points: [
				{ id: 'start', position: 0, value: 0.2 },
				{ id: 'end', position: 48_000, value: 0.8 },
			],
			segments: [{ kind: 'linear' }],
		}],
	} as EngineProject;
}

function trackSidechainProjectV21(): EngineProject {
	const limiter = (id: string, frames: number) => ({
		id,
		type: 'limiter',
		enabled: true,
		bypassed: false,
		params: { lookahead: (frames - 0.001) / 48_000, ceiling: 0, release: 0.01 },
	});
	const track = (id: string, frames: number) => ({
		type: 'audio' as const,
		id,
		gain: 1,
		pan: 0,
		mute: false,
		solo: false,
		effectsActive: true,
		effects: [limiter(`${id}-limit`, frames)],
	});
	const edge = (
		id: string,
		kind: 'assignment' | 'sidechain',
		source: Record<string, unknown>,
		destination: Record<string, unknown>,
		level = 1,
	) => ({
		id, kind, source, destination, position: 'post-fader' as const,
		level, enabled: true, channelMap: [0, 1],
	});
	return {
		schemaVersion: 21,
		sampleRate: 48_000,
		masterChannels: 2,
		tracks: [track('program', 20), track('control', 7)],
		master: {
			gain: 1, pan: 0, mute: false, solo: false, effectsActive: true, effects: [],
		},
		mixer: {
			schemaVersion: 1,
			groups: [], sends: [], cues: [], vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }],
			edges: [
				edge('control-program', 'sidechain', { kind: 'track', id: 'control' }, {
					kind: 'effect-sidechain',
					strip: { kind: 'track', id: 'program' },
					effectId: 'program-limit',
				}),
				edge('program-master', 'assignment', { kind: 'track', id: 'program' }, { kind: 'master' }),
				edge('control-master', 'assignment', { kind: 'track', id: 'control' }, { kind: 'master' }, 0),
				edge('master-main', 'assignment', { kind: 'master' }, { kind: 'output', id: 'main' }),
			],
		},
	} as EngineProject;
}
