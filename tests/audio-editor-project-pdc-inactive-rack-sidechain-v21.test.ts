/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { projectGraphLatencyFramesV21 } from '../src/common/editor/engine/project-graph-v21.ts';
import { compileProjectPathPdcPlanV21 } from '../src/common/editor/engine/project-path-pdc-plan-v21.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';

type Owner = 'track' | 'mixer-node' | 'master';

const OWNERS: readonly Owner[] = ['track', 'mixer-node', 'master'];

test('a sidechain into a switched-off rack still compiles a PDC plan', () => {
	for (const owner of OWNERS) {
		const plan = compileProjectPathPdcPlanV21(project(owner, false), { sampleRate: 48_000 });
		assert.equal(plan.edgeCompensationFrames.get('sc'), 0, owner);
		assert.equal(plan.nodeInputLatencyFrames.get(hostKey(owner)), 0, owner);
		assert.equal(plan.nodeOutputLatencyFrames.get(hostKey(owner)), 0, owner);
		assert.equal(plan.latencyFrames, 0, owner);
	}
});

test('automation on an effect in a switched-off rack resolves to the rack input', () => {
	for (const owner of OWNERS) {
		const plan = compileProjectPathPdcPlanV21(project(owner, false), { sampleRate: 48_000 });
		assert.equal(
			plan.automationLatencyFrames({
				kind: 'effect', strip: stripRef(owner), effectId: 'lim', parameterId: 'threshold',
			}),
			0,
			owner,
		);
	}
});

test('a switched-on rack still contributes its sidechain-addressed latency', () => {
	for (const owner of OWNERS) {
		const plan = compileProjectPathPdcPlanV21(project(owner, true), { sampleRate: 48_000 });
		assert.equal(plan.nodeOutputLatencyFrames.get(hostKey(owner)), 480, owner);
		assert.equal(plan.edgeCompensationFrames.get('sc'), 0, owner);
	}
});

test('play and export latency resolves for a switched-off rack holding a sidechain target', () => {
	for (const owner of OWNERS) {
		assert.equal(projectGraphLatencyFramesV21(project(owner, false) as unknown as EngineProject), 0, owner);
	}
});

function hostKey(owner: Owner): string {
	if (owner === 'master') return 'master';
	return owner === 'track' ? 'track:voice' : 'mixer-node:stem';
}

function stripRef(owner: Owner): Record<string, unknown> {
	if (owner === 'master') return { kind: 'master' };
	return owner === 'track' ? { kind: 'track', id: 'voice' } : { kind: 'mixer-node', id: 'stem' };
}

/**
 * Track 'kick' feeds a sidechain edge into limiter 'lim', hosted by the rack named by
 * `owner`. The rack switch is authored state the document validator accepts either way,
 * so the compiler has to keep the addressed slot resolvable when the rack is off.
 */
function project(owner: Owner, effectsActive: boolean): MutableProject {
	const hosted = (kind: Owner): MutableEffect[] => (
		owner === kind ? [{ id: 'lim', type: 'limiter', enabled: true, params: { lookahead: 0.01 } }] : []
	);
	return {
		sampleRate: 48_000,
		masterChannels: 2,
		tracks: [
			{
				id: 'voice', type: 'audio',
				effectsActive: owner === 'track' ? effectsActive : true,
				effects: hosted('track'),
			},
			{ id: 'kick', type: 'audio', effectsActive: true, effects: [] },
		],
		master: { effectsActive: owner === 'master' ? effectsActive : true, effects: hosted('master') },
		mixer: {
			schemaVersion: 1,
			groups: [strip('stem', owner === 'mixer-node' ? effectsActive : true, hosted('mixer-node'))],
			sends: [], cues: [], vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }],
			edges: [
				edge('voice-stem', { kind: 'track', id: 'voice' }, { kind: 'mixer-node', id: 'stem' }),
				edge('kick-stem', { kind: 'track', id: 'kick' }, { kind: 'mixer-node', id: 'stem' }),
				edge('stem-master', { kind: 'mixer-node', id: 'stem' }, { kind: 'master' }),
				edge('master-main', { kind: 'master' }, { kind: 'output', id: 'main' }),
				{
					id: 'sc', kind: 'sidechain',
					source: { kind: 'track', id: 'kick' },
					destination: { kind: 'effect-sidechain', strip: stripRef(owner), effectId: 'lim' },
					position: 'post-fader', level: 1, enabled: true, channelMap: [],
				},
			],
		},
	};
}

function strip(id: string, effectsActive: boolean, effects: MutableEffect[]): MutableStrip {
	return { id, name: id, color: '#4f87c8', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: true, effectsActive, effects, channelCount: 2 };
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
interface MutableProject { sampleRate: number; masterChannels: number;
	tracks: Array<{ id: string; type: string; effectsActive: boolean; effects: MutableEffect[] }>;
	master: { effectsActive: boolean; effects: MutableEffect[] }; mixer: { schemaVersion: number; groups: MutableStrip[];
		sends: MutableStrip[]; cues: MutableStrip[]; vcas: unknown[]; outputs: unknown[]; edges: MutableEdge[] } }
