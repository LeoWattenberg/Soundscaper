/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EngineEffect, EngineProject } from '../../src/common/editor/engine/types.ts';

export function parallelPlanningFixture(seed: number): EngineProject {
	const strip = (id: string, effects: EngineEffect[] = []) => ({
		id, name: id, color: '', gain: .75, pan: 0, mute: false, solo: false,
		collapsed: false, effectsActive: true, effects, channelCount: 2,
	});
	const trackCount = seed % 8 + 2;
	const groups = Array.from({ length: seed % 5 + 1 }, (_, index) => strip(`group-${String(index)}`));
	const sends = [strip('send')];
	const cues = [strip('cue')];
	const tracks = Array.from({ length: trackCount }, (_, index) => ({
		...strip(`track-${String(index)}`, index % 2 === 0 ? [
			{ id: `crush-${String(index)}`, type: 'bitcrusher', params: { bitDepth: 8 } },
			{ id: `limit-${String(index)}`, type: 'limiter', params: { lookahead: .001 * (seed % 4), ceiling: 0 } },
			{ id: `off-${String(index)}`, type: 'reverb', enabled: false },
		] : []), type: 'audio', solo: seed % 3 === 0 && index === 0,
	}));
	const edge = (id: string, source: Record<string, unknown>, destination: Record<string, unknown>,
		kind = 'assignment', enabled = true) => ({ id, kind, source, destination, enabled,
		position: 'post-fader', level: .8, channelMap: [0, 1],
	});
	const edges = tracks.map((track, index) => edge(`track-edge-${String(index)}`,
		{ kind: 'track', id: track.id }, { kind: 'mixer-node', id: groups[index % groups.length]!.id }));
	for (let index = 0; index < groups.length; index += 1) edges.push(edge(`group-edge-${String(index)}`,
		{ kind: 'mixer-node', id: groups[index]!.id },
		index === 0 ? { kind: 'master' } : { kind: 'mixer-node', id: groups[index - 1]!.id }));
	edges.push(edge('send-edge', { kind: 'track', id: tracks[1]!.id }, { kind: 'mixer-node', id: 'send' }, 'send'));
	edges.push(edge('send-master', { kind: 'mixer-node', id: 'send' }, { kind: 'master' }));
	edges.push(edge('cue-edge', { kind: 'track', id: tracks[1]!.id }, { kind: 'mixer-node', id: 'cue' }, 'send'));
	edges.push(edge('cue-output', { kind: 'mixer-node', id: 'cue' }, { kind: 'output', id: 'cue-output' }));
	edges.push(edge('master-main', { kind: 'master' }, { kind: 'output', id: 'main' }));
	if (seed % 2 === 0) edges.push(edge('detector', { kind: 'track', id: tracks[1]!.id },
		{ kind: 'effect-sidechain', strip: { kind: 'track', id: tracks[0]!.id }, effectId: 'limit-0' }, 'sidechain'));
	if (seed % 7 === 0) tracks[0]!.effectsActive = false;
	if (seed % 11 === 0) tracks[0]!.effects[0] = { id: 'unsupported', type: 'reverb' };
	if (seed % 13 === 0) tracks[0]!.effects.push({ id: 'eq', type: 'parametric-eq', params: { bands: [] } });
	const result = {
		schemaFamily: 'soundscaper', schemaVersion: 1, sampleRate: 48_000, masterChannels: 2,
		tracks, master: strip('master'), mixer: { schemaVersion: 1, groups, sends, cues,
			vcas: [
				{ id: 'vca-1', name: 'one', gain: .1, mute: false,
					members: [{ kind: 'track', id: tracks[0]!.id }, { kind: 'mixer-node', id: groups[0]!.id }] },
				{ id: 'vca-2', name: 'two', gain: .3, mute: seed % 17 === 0,
					members: [{ kind: 'track', id: tracks[0]!.id }, { kind: 'mixer-node', id: 'send' }] },
			], outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 },
				{ id: 'cue-output', name: 'Cue', role: 'cue', channelCount: 2 }], edges },
	};
	return result;
}
