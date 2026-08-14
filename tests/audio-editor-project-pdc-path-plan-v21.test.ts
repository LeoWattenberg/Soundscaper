/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { compileProjectPathPdcPlanV21 } from '../src/common/editor/engine/project-path-pdc-plan-v21.ts';

test('aligns every nested assignment path at every merge and reports exact zero error', () => {
	const plan = compileProjectPathPdcPlanV21(project(), { sampleRate: 48_000 });
	assert.equal(plan.nodeOutputLatencyFrames.get('track:voice'), 480);
	assert.equal(plan.nodeOutputLatencyFrames.get('track:music'), 0);
	assert.equal(plan.nodeInputLatencyFrames.get('mixer-node:dialogue'), 480);
	assert.equal(plan.nodeOutputLatencyFrames.get('mixer-node:dialogue'), 720);
	assert.equal(plan.nodeInputLatencyFrames.get('mixer-node:stem'), 720);
	assert.equal(plan.edgeCompensationFrames.get('music-stem'), 720);
	assert.equal(plan.edgeCompensationFrames.get('dialogue-stem'), 0);
	assert.equal(plan.nodeOutputLatencyFrames.get('mixer-node:stem'), 816);
	assert.equal(plan.nodeInputLatencyFrames.get('master'), 816);
	assert.equal(plan.nodeOutputLatencyFrames.get('master'), 864);
	assert.equal(plan.outputLatencyFrames.get('main'), 864);
	assert.equal(plan.latencyFrames, 864);
});

test('uses the same path offsets for automation, monitoring, render, and track-local freeze', () => {
	const plan = compileProjectPathPdcPlanV21(project(), { sampleRate: 48_000 });
	assert.equal(plan.automationLatencyFrames({ kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' }), 480);
	assert.equal(plan.automationLatencyFrames({ kind: 'strip', strip: { kind: 'mixer-node', id: 'stem' }, parameterId: 'pan' }), 816);
	assert.equal(plan.automationLatencyFrames({ kind: 'strip', strip: { kind: 'master' }, parameterId: 'mute' }), 864);
	assert.equal(plan.freezeLatencyFramesByTrack.get('voice'), 480);
	assert.equal(plan.freezeLatencyFramesByTrack.get('music'), 0);
	assert.equal(plan.monitoringLatencyFrames, plan.renderLatencyFrames);
	assert.equal(plan.monitoringLatencyFrames, plan.latencyFrames);
});

test('aligns an explicit sidechain at the addressed effect stage', () => {
	const value = project();
	value.tracks[1]!.effects = [{ id: 'music-delay', type: 'limiter', enabled: true, params: { lookahead: 0.02 } }];
	value.mixer.edges.push({
		id: 'music-ducks-voice', kind: 'sidechain',
		source: { kind: 'mixer-node', id: 'dialogue' },
		destination: { kind: 'effect-sidechain', strip: { kind: 'track', id: 'music' }, effectId: 'music-delay' },
		position: 'post-fader', level: 1, enabled: true, channelMap: [],
	});
	const plan = compileProjectPathPdcPlanV21(value, { sampleRate: 48_000 });
	assert.equal(plan.nodeInputLatencyFrames.get('track:music'), 720);
	assert.equal(plan.edgeCompensationFrames.get('music-ducks-voice'), 0);
	assert.equal(plan.nodeOutputLatencyFrames.get('track:music'), 1_680);
	assert.equal(plan.nodeInputLatencyFrames.get('mixer-node:stem'), 1_680);
	assert.equal(plan.edgeCompensationFrames.get('dialogue-stem'), 960);
});

test('disabled edges do not affect path compensation and unreachable output is rejected', () => {
	const value = project();
	value.mixer.edges.push({
		id: 'disabled-loop', kind: 'send', source: { kind: 'mixer-node', id: 'stem' },
		destination: { kind: 'mixer-node', id: 'dialogue' }, position: 'post-fader', level: 1,
		enabled: false, channelMap: [],
	});
	assert.equal(compileProjectPathPdcPlanV21(value).edgeCompensationFrames.get('disabled-loop'), 0);
	value.mixer.edges = value.mixer.edges.filter(({ id }) => id !== 'master-main');
	assert.throws(() => compileProjectPathPdcPlanV21(value), /output|reachable/iu);
});

function project(): MutableProject {
	return {
		sampleRate: 48_000,
		tracks: [
			{ id: 'voice', type: 'audio', effectsActive: true, effects: [
				{ id: 'voice-delay', type: 'limiter', enabled: true, params: { lookahead: 0.01 } },
			] },
			{ id: 'music', type: 'audio', effectsActive: true, effects: [] },
		],
		master: { effectsActive: true, effects: [
			{ id: 'master-delay', type: 'limiter', enabled: true, params: { lookahead: 0.001 } },
		] },
		mixer: {
			schemaVersion: 1,
			groups: [
				strip('dialogue', [{ id: 'dialogue-delay', type: 'limiter', enabled: true, params: { lookahead: 0.005 } }]),
				strip('stem', [{ id: 'stem-delay', type: 'limiter', enabled: true, params: { lookahead: 0.002 } }]),
			],
			sends: [], cues: [], vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }],
			edges: [
				edge('voice-dialogue', { kind: 'track', id: 'voice' }, { kind: 'mixer-node', id: 'dialogue' }),
				edge('dialogue-stem', { kind: 'mixer-node', id: 'dialogue' }, { kind: 'mixer-node', id: 'stem' }),
				edge('music-stem', { kind: 'track', id: 'music' }, { kind: 'mixer-node', id: 'stem' }),
				edge('stem-master', { kind: 'mixer-node', id: 'stem' }, { kind: 'master' }),
				edge('master-main', { kind: 'master' }, { kind: 'output', id: 'main' }),
			],
		},
	};
}

function strip(id: string, effects: MutableEffect[]): MutableStrip {
	return { id, name: id, color: '#4f87c8', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: true, effectsActive: true, effects, channelCount: 2 };
}

function edge(id: string, source: Record<string, unknown>, destination: Record<string, unknown>): MutableEdge {
	return { id, kind: 'assignment', source, destination, position: 'post-fader', level: 1,
		enabled: true, channelMap: [] };
}

interface MutableEffect { id: string; type: string; enabled: boolean; params: Record<string, number> }
interface MutableStrip { id: string; name: string; color: string; gain: number; pan: number; mute: boolean; solo: boolean;
	collapsed: boolean; effectsActive: boolean; effects: MutableEffect[]; channelCount: number }
interface MutableEdge { id: string; kind: string; source: Record<string, unknown>; destination: Record<string, unknown>;
	position: string; level: number; enabled: boolean; channelMap: number[] }
interface MutableProject { sampleRate: number; tracks: Array<{ id: string; type: string; effectsActive: boolean; effects: MutableEffect[] }>;
	master: { effectsActive: boolean; effects: MutableEffect[] }; mixer: { schemaVersion: number; groups: MutableStrip[];
		sends: MutableStrip[]; cues: MutableStrip[]; vcas: unknown[]; outputs: unknown[]; edges: MutableEdge[] } }
