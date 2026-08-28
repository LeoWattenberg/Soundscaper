/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	evaluateIndependentProjectPdcReferenceV21,
} from '../src/common/editor/quality/project-pdc-reference-v21.ts';
import { compileProjectPathPdcPlanV21 } from '../src/common/editor/engine/project-path-pdc-plan-v21.ts';
import { projectGraphLatencyFrames } from '../src/common/editor/engine/project-graph.ts';

const SAMPLE_RATE = 48_000;

test('the V21 PDC oracle is mechanically independent from the production path compiler', async () => {
	const source = await readFile(new URL(
		'../src/common/editor/quality/project-pdc-reference-v21.ts',
		import.meta.url,
	), 'utf8');
	assert.doesNotMatch(source, /project-path-pdc-plan/iu);
	assert.doesNotMatch(source, /compileProjectPathPdcPlanV21/u);
});

test('independent PDC landmarks cover chains, diamonds, nested buses, sends, sidechains, and parallel paths', () => {
	for (const [name, project] of Object.entries(referenceProjects())) {
		const reference = evaluateIndependentProjectPdcReferenceV21(project, { sampleRate: SAMPLE_RATE });
		const production = compileProjectPathPdcPlanV21(project, { sampleRate: SAMPLE_RATE });
		assert.deepEqual(
			mapEntries(production.nodeInputLatencyFrames),
			mapEntries(reference.nodeInputLatencyFrames),
			`${name}: input offsets`,
		);
		assert.deepEqual(
			mapEntries(production.nodeOutputLatencyFrames),
			mapEntries(reference.nodeOutputLatencyFrames),
			`${name}: output offsets`,
		);
		assert.deepEqual(
			mapEntries(production.edgeCompensationFrames),
			mapEntries(reference.edgeCompensationFrames),
			`${name}: edge compensation`,
		);
		assert.deepEqual(
			mapEntries(production.outputLatencyFrames),
			mapEntries(reference.outputLatencyFrames),
			`${name}: terminal offsets`,
		);
		// A landmark's arrival is derived from its own compensation, so checking one
		// against the other can only ever report zero. What the map comparisons above
		// cannot see is whether the oracle reported a landmark for every edge at all,
		// so assert coverage of exactly the enabled edges instead.
		assert.deepEqual(
			[...reference.landmarks].map(({ edgeId }) => edgeId).sort(),
			project.mixer.edges.filter(({ enabled }) => enabled).map(({ id }) => id).sort(),
			`${name}: landmark coverage`,
		);
	}
});

test('independent consumer offsets agree across live, monitoring, offline, stems, and freeze', () => {
	const project = referenceProjects().sidechains;
	const reference = evaluateIndependentProjectPdcReferenceV21(project, { sampleRate: SAMPLE_RATE });
	const production = compileProjectPathPdcPlanV21(project, { sampleRate: SAMPLE_RATE });

	assert.equal(reference.consumerOffsets.live, production.latencyFrames);
	assert.equal(reference.consumerOffsets.monitoring, production.monitoringLatencyFrames);
	assert.equal(reference.consumerOffsets.offline, production.renderLatencyFrames);
	for (const track of project.tracks) {
		assert.equal(
			reference.consumerOffsets.stemsByTrack.get(track.id),
			projectGraphLatencyFrames(project, {
				trackId: track.id,
				includeMaster: false,
				sampleRate: SAMPLE_RATE,
			}),
			`${track.id}: stem offset`,
		);
		assert.equal(
			reference.consumerOffsets.freezeByTrack.get(track.id),
			production.freezeLatencyFramesByTrack.get(track.id),
			`${track.id}: freeze offset`,
		);
	}
	assert.equal(reference.automationLatencyFrames({
		kind: 'effect', strip: { kind: 'track', id: 'program' }, effectId: 'program-limit', parameterId: 'ceiling',
	}), production.automationLatencyFrames({
		kind: 'effect', strip: { kind: 'track', id: 'program' }, effectId: 'program-limit', parameterId: 'ceiling',
	}));
	assert.equal(reference.automationLatencyFrames({
		kind: 'edge', edgeId: 'program-fast', parameterId: 'level',
	}), production.automationLatencyFrames({
		kind: 'edge', edgeId: 'program-fast', parameterId: 'level',
	}));
	assert.equal(reference.automationLatencyFrames({
		kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain',
	}), production.automationLatencyFrames({
		kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain',
	}));
});

function referenceProjects(): Readonly<Record<string, ReferenceProject>> {
	return Object.freeze({
		chains: project({
			tracks: [track('voice', 5)],
			groups: [strip('first', 7), strip('second', 11)],
			edges: [
				edge('voice-first', trackEndpoint('voice'), nodeEndpoint('first')),
				edge('first-second', nodeEndpoint('first'), nodeEndpoint('second')),
				edge('second-master', nodeEndpoint('second'), masterEndpoint()),
				outputEdge(),
			],
			masterLatency: 13,
		}),
		diamonds: project({
			tracks: [track('voice')],
			groups: [strip('fast'), strip('slow', 17), strip('merge')],
			edges: [
				edge('voice-fast', trackEndpoint('voice'), nodeEndpoint('fast')),
				edge('voice-slow', trackEndpoint('voice'), nodeEndpoint('slow')),
				edge('fast-merge', nodeEndpoint('fast'), nodeEndpoint('merge')),
				edge('slow-merge', nodeEndpoint('slow'), nodeEndpoint('merge')),
				edge('merge-master', nodeEndpoint('merge'), masterEndpoint()),
				outputEdge(),
			],
		}),
		nestedBuses: project({
			tracks: [track('voice', 3)],
			groups: [strip('child', 5), strip('parent', 7), strip('grandparent', 11)],
			edges: [
				edge('voice-child', trackEndpoint('voice'), nodeEndpoint('child')),
				edge('child-parent', nodeEndpoint('child'), nodeEndpoint('parent')),
				edge('parent-grandparent', nodeEndpoint('parent'), nodeEndpoint('grandparent')),
				edge('grandparent-master', nodeEndpoint('grandparent'), masterEndpoint()),
				outputEdge(),
			],
		}),
		sends: project({
			tracks: [track('voice')],
			groups: [strip('dry'), strip('merge')],
			sends: [strip('reverb-send', 19)],
			edges: [
				edge('voice-dry', trackEndpoint('voice'), nodeEndpoint('dry')),
				edge('voice-send', trackEndpoint('voice'), nodeEndpoint('reverb-send'), 'send'),
				edge('dry-merge', nodeEndpoint('dry'), nodeEndpoint('merge')),
				edge('send-merge', nodeEndpoint('reverb-send'), nodeEndpoint('merge')),
				edge('merge-master', nodeEndpoint('merge'), masterEndpoint()),
				outputEdge(),
			],
		}),
		sidechains: project({
			tracks: [track('program', 23), track('control', 7)],
			groups: [strip('fast'), strip('parent')],
			sends: [strip('slow', 11)],
			edges: [
				edge('control-program', trackEndpoint('control'), {
					kind: 'effect-sidechain', strip: trackEndpoint('program'), effectId: 'program-limit',
				}, 'sidechain'),
				edge('program-fast', trackEndpoint('program'), nodeEndpoint('fast')),
				edge('program-slow', trackEndpoint('program'), nodeEndpoint('slow'), 'send'),
				edge('fast-parent', nodeEndpoint('fast'), nodeEndpoint('parent')),
				edge('slow-parent', nodeEndpoint('slow'), nodeEndpoint('parent')),
				edge('parent-master', nodeEndpoint('parent'), masterEndpoint()),
				edge('control-master-sidechain', trackEndpoint('control'), {
					kind: 'effect-sidechain', strip: masterEndpoint(), effectId: 'master-limit',
				}, 'sidechain'),
				edge('control-master', trackEndpoint('control'), masterEndpoint(), 'assignment', 0),
				outputEdge(),
			],
			masterLatency: 13,
		}),
		parallelPaths: project({
			tracks: [track('left', 2), track('right', 29), track('center', 13)],
			groups: [strip('parallel')],
			edges: [
				edge('left-parallel', trackEndpoint('left'), nodeEndpoint('parallel')),
				edge('right-parallel', trackEndpoint('right'), nodeEndpoint('parallel')),
				edge('center-parallel', trackEndpoint('center'), nodeEndpoint('parallel')),
				edge('parallel-master', nodeEndpoint('parallel'), masterEndpoint()),
				outputEdge(),
			],
		}),
	});
}

function project({
	tracks, groups = [], sends = [], edges, masterLatency = 0,
}: Readonly<{
	tracks: ReferenceTrack[];
	groups?: ReferenceStrip[];
	sends?: ReferenceStrip[];
	edges: ReferenceEdge[];
	masterLatency?: number;
}>): ReferenceProject {
	return {
		schemaFamily: 'soundscaper', schemaVersion: 1,
		sampleRate: SAMPLE_RATE,
		masterChannels: 2,
		tracks,
		master: effectHost('master', masterLatency),
		mixer: {
			schemaVersion: 1,
			groups,
			sends,
			cues: [],
			vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }],
			edges,
		},
		automationLanes: [],
	};
}

function track(id: string, latency = 0): ReferenceTrack {
	return { id, type: 'audio', ...effectHost(id, latency) };
}

function strip(id: string, latency = 0): ReferenceStrip {
	return {
		id, name: id, color: '#000000', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: false, channelCount: 2, ...effectHost(id, latency),
	};
}

function effectHost(id: string, latency: number) {
	return {
		effectsActive: true,
		effects: latency === 0 ? [] : [{
			id: `${id}-limit`, type: 'limiter', enabled: true, bypassed: false,
			params: { lookahead: (latency - 0.001) / SAMPLE_RATE, ceiling: 0, release: 0.01 },
		}],
	};
}

function edge(
	id: string,
	source: ReferenceEndpoint,
	destination: ReferenceDestination,
	kind: 'assignment' | 'send' | 'sidechain' = 'assignment',
	level = 1,
): ReferenceEdge {
	return { id, kind, source, destination, position: 'post-fader', level, enabled: true, channelMap: [0, 1] };
}

function outputEdge(): ReferenceEdge {
	return edge('master-main', masterEndpoint(), { kind: 'output', id: 'main' });
}

function trackEndpoint(id: string): ReferenceEndpoint & { readonly kind: 'track' } {
	return { kind: 'track', id };
}

function nodeEndpoint(id: string): ReferenceEndpoint & { readonly kind: 'mixer-node' } {
	return { kind: 'mixer-node', id };
}

function masterEndpoint(): ReferenceEndpoint & { readonly kind: 'master' } {
	return { kind: 'master' };
}

function mapEntries(map: ReadonlyMap<string, number>): readonly (readonly [string, number])[] {
	return [...map].sort(([left], [right]) => left.localeCompare(right));
}

interface ReferenceEffectHost {
	readonly effectsActive: boolean;
	readonly effects: readonly Readonly<Record<string, unknown>>[];
}

interface ReferenceTrack extends ReferenceEffectHost {
	readonly id: string;
	readonly type: 'audio';
}

interface ReferenceStrip extends ReferenceEffectHost {
	readonly id: string;
	readonly name: string;
	readonly color: string;
	readonly gain: number;
	readonly pan: number;
	readonly mute: boolean;
	readonly solo: boolean;
	readonly collapsed: boolean;
	readonly channelCount: number;
}

type ReferenceEndpoint =
	| Readonly<{ readonly kind: 'track'; readonly id: string }>
	| Readonly<{ readonly kind: 'mixer-node'; readonly id: string }>
	| Readonly<{ readonly kind: 'master' }>;

type ReferenceDestination = ReferenceEndpoint | Readonly<{
	readonly kind: 'output';
	readonly id: string;
}> | Readonly<{
	readonly kind: 'effect-sidechain';
	readonly strip: ReferenceEndpoint;
	readonly effectId: string;
}>;

interface ReferenceEdge {
	readonly id: string;
	readonly kind: 'assignment' | 'send' | 'sidechain';
	readonly source: ReferenceEndpoint;
	readonly destination: ReferenceDestination;
	readonly position: 'post-fader';
	readonly level: number;
	readonly enabled: boolean;
	readonly channelMap: readonly number[];
}

interface ReferenceProject extends Readonly<Record<string, unknown>> {
	readonly schemaFamily: 'soundscaper';
	readonly schemaVersion: 1;
	readonly sampleRate: number;
	readonly masterChannels: number;
	readonly tracks: readonly ReferenceTrack[];
	readonly automationLanes: readonly unknown[];
	readonly master: ReferenceEffectHost;
	readonly mixer: Readonly<{
		readonly schemaVersion: 1;
		readonly groups: readonly ReferenceStrip[];
		readonly sends: readonly ReferenceStrip[];
		readonly cues: readonly ReferenceStrip[];
		readonly vcas: readonly unknown[];
		readonly outputs: readonly Readonly<Record<string, unknown>>[];
		readonly edges: readonly ReferenceEdge[];
	}>;
}
