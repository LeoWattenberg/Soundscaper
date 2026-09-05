/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { NATIVE_EFFECT_LATENCY_MAX_SECONDS } from '../src/common/editor/engine/native-effect-latency-v21.ts';
import {
	engineNativeEffectPdcControlMethods,
	type EngineNativeEffectPdcCommit,
	type EngineNativeEffectPdcRevision,
} from '../src/common/editor/engine/native-effect-pdc-control.ts';
import { applyEdgeCompensation } from '../src/common/editor/engine/project-graph-v21-edges.ts';
import { buildProjectGraphV21 } from '../src/common/editor/engine/project-graph-v21.ts';
import { compileProjectPathPdcPlanV21 } from '../src/common/editor/engine/project-path-pdc-plan-v21.ts';

const SAMPLE_RATE = 48_000;
/** Inside the ledger's admitted range: 1.5 s of claimed plug-in latency. */
const CLAIMED_FRAMES = 72_000;

/**
 * A delay param that behaves like Web Audio's: `delayTime.maxValue` is the
 * node's construction-time `maxDelayTime`, and a scheduled value above it is
 * clamped rather than refused.
 */
class ClampingParam {
	value: number;
	readonly maxValue: number;

	constructor(value: number, maxValue: number) {
		this.maxValue = maxValue;
		this.value = clampToRange(value, maxValue);
	}

	setValueAtTime(value: number) { this.value = clampToRange(value, this.maxValue); return this; }
	linearRampToValueAtTime(value: number) { this.value = clampToRange(value, this.maxValue); return this; }
	cancelScheduledValues() { return this; }
}

function clampToRange(value: number, maximum: number): number {
	return Math.min(Math.max(value, 0), maximum);
}

interface FakeNode extends Record<string, unknown> {
	readonly kind: string;
	connect(target: unknown): unknown;
	disconnect(): void;
}

interface FakeDelay extends FakeNode {
	readonly maxDelayTime: number;
	readonly delayTime: ClampingParam;
}

class FakeContext {
	readonly sampleRate = SAMPLE_RATE;
	readonly currentTime = 0;
	readonly delays: FakeDelay[] = [];
	#counter = 0;

	createGain() { return this.#make('gain', { gain: new ClampingParam(1, 3.4e38) }); }
	createDelay(maxDelayTime = 1) {
		const delay = this.#make('delay', {
			maxDelayTime, delayTime: new ClampingParam(0, maxDelayTime),
		}) as FakeDelay;
		this.delays.push(delay);
		return delay;
	}

	createChannelSplitter(channels: number) { return this.#make('splitter', { channels }); }
	createChannelMerger(channels: number) { return this.#make('merger', { channels }); }

	#make(kind: string, fields: Record<string, unknown>): FakeNode {
		this.#counter += 1;
		const node: FakeNode = {
			kind, id: `${kind}#${String(this.#counter)}`, ...fields,
			connect(target: unknown) { return target; },
			disconnect() { /* nothing to release in the fake graph */ },
		};
		return node;
	}
}

test('a retunable compensation delay is built for the live range the latency ledger admits', () => {
	const context = new FakeContext();
	const nodes: unknown[] = [];
	const registered: unknown[] = [];
	applyEdgeCompensation(
		context as never, nodes as never, context.createGain() as never, 0,
		(param) => registered.push(param),
	);
	assert.equal(registered.length, 1, 'the seam is registered as retunable');
	const built = context.delays.at(-1)!;
	assert.ok(
		built.maxDelayTime >= NATIVE_EFFECT_LATENCY_MAX_SECONDS,
		`a delay built for ${String(built.maxDelayTime)} s cannot carry the `
		+ `${String(NATIVE_EFFECT_LATENCY_MAX_SECONDS)} s a hosted plug-in may claim`,
	);
});

test('a retunable delay that already compensates keeps room for a fresh plug-in claim', () => {
	const context = new FakeContext();
	const nodes: unknown[] = [];
	applyEdgeCompensation(
		context as never, nodes as never, context.createGain() as never, SAMPLE_RATE, () => {},
	);
	const built = context.delays.at(-1)!;
	assert.equal(built.delayTime.value, 1, 'the built-time compensation is one second');
	assert.ok(
		built.maxDelayTime >= 1 + NATIVE_EFFECT_LATENCY_MAX_SECONDS,
		`a delay already carrying 1 s and built for ${String(built.maxDelayTime)} s cannot absorb `
		+ 'a plug-in claim on top of it',
	);
});

test('a live PDC revision inside the admitted range reaches the graph unclamped', () => {
	const context = new FakeContext();
	const graph = buildProjectGraphV21(
		context as never, context.createGain() as never, projectAtZeroLatency() as never,
		{ metering: false, includeTrackPan: false, monitoring: false } as never,
	);
	const plan = compileProjectPathPdcPlanV21(
		projectWithNativeLatency(CLAIMED_FRAMES) as never, { sampleRate: SAMPLE_RATE },
	);
	const compensated = [...plan.edgeCompensationFrames].filter(([, frames]) => frames > 0);
	assert.deepEqual(
		compensated, [['b-master', CLAIMED_FRAMES]],
		'the sibling edge carries the claimed latency as compensation',
	);
	assert.ok(
		CLAIMED_FRAMES <= NATIVE_EFFECT_LATENCY_MAX_SECONDS * SAMPLE_RATE,
		'the claim is one the ledger admits',
	);

	const commit = commitRevision(graph, context, { atFrame: 128, blockFrames: 128, pdcErrorSamples: 0, plan });
	assert.equal(commit.status, 'scheduled');
	const param = graph.pathPdcDelayParamsV21!.get('edge:b-master') as unknown as ClampingParam;
	assert.equal(
		param.value, CLAIMED_FRAMES / SAMPLE_RATE,
		'the sibling path carries the whole revision rather than a silently truncated one',
	);
});

test('a live PDC revision beyond the built delay is refused rather than truncated', () => {
	const context = new FakeContext();
	const graph = buildProjectGraphV21(
		context as never, context.createGain() as never, projectAtZeroLatency() as never,
		{ metering: false, includeTrackPan: false, monitoring: false } as never,
	);
	const beyond = Math.ceil((NATIVE_EFFECT_LATENCY_MAX_SECONDS + 10) * SAMPLE_RATE);
	const plan = compileProjectPathPdcPlanV21(
		projectWithNativeLatency(beyond) as never, { sampleRate: SAMPLE_RATE },
	);
	assert.throws(
		() => commitRevision(graph, context, { atFrame: 128, blockFrames: 128, pdcErrorSamples: 0, plan }),
		RangeError,
		'a revision the graph cannot carry must fault instead of reporting an exact swap',
	);
	const param = graph.pathPdcDelayParamsV21!.get('edge:b-master') as unknown as ClampingParam;
	assert.equal(param.value, 0, 'a refused revision leaves the published compensation alone');
});

function commitRevision(
	graph: unknown, context: FakeContext, request: EngineNativeEffectPdcRevision,
): EngineNativeEffectPdcCommit {
	const commit = engineNativeEffectPdcControlMethods.commitNativeEffectPdcRevision as unknown as (
		this: unknown, revision: EngineNativeEffectPdcRevision,
	) => EngineNativeEffectPdcCommit;
	return commit.call({
		graph, context, state: 'playing', sampleRate: SAMPLE_RATE, playbackRate: 1,
		getPositionFrames: () => 0,
	}, request);
}

/**
 * The graph as it is built while the hosted plug-in still reports zero latency:
 * every compensation seam is retunable but compensates nothing. The plug-in's
 * own processor is left out because a fake context cannot instantiate the
 * native real-time worklet, and at zero it contributes no compensation anyway.
 */
function projectAtZeroLatency() {
	return { ...projectWithNativeLatency(0), tracks: [track('A', []), track('B', [])] };
}

/** The same document once the plug-in claims `latencyFrames` of its own delay. */
function projectWithNativeLatency(latencyFrames: number) {
	return {
		schemaFamily: 'soundscaper', schemaVersion: 1,
		sampleRate: SAMPLE_RATE, masterChannels: 2,
		tracks: [
			track('A', [{
				id: 'a-native', type: 'native-plugin', enabled: true, bypassed: false,
				params: { instanceId: 'instance-a', latencyFrames },
			}]),
			track('B', []),
		],
		master: { gain: 1, pan: 0, mute: false, solo: false, effectsActive: true, effects: [] },
		mixer: {
			schemaVersion: 1,
			groups: [], sends: [], cues: [], vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }],
			edges: [
				edge('a-master', { kind: 'track', id: 'A' }, { kind: 'master' }),
				edge('b-master', { kind: 'track', id: 'B' }, { kind: 'master' }),
				edge('master-main', { kind: 'master' }, { kind: 'output', id: 'main' }),
			],
		},
		automationLanes: [], clips: [], sources: [],
	};
}

function track(id: string, effects: readonly unknown[]) {
	return {
		id, type: 'audio', gain: 1, pan: 0, mute: false, solo: false,
		effectsActive: true, effects, clipIds: [],
	};
}

function edge(id: string, source: unknown, destination: unknown) {
	return {
		id, kind: 'assignment', source, destination,
		position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1],
	};
}
