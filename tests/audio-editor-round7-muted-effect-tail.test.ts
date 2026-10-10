/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffect, projectEffectTailFrames } from '../src/common/editor/effects.js';
import { createExportPlan } from '../src/common/editor/export.js';
import { resolveRenderTailSeconds } from '../src/common/editor/engine/rendering-range.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { createAudioTrack, createAudioClip, createAudioSource } from '../src/common/editor/project-media-factory.ts';
import type { ParameterAddress } from '../src/common/editor/parameter-address.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

const RATE = 48_000;
const delay = createEffect('delay', { params: { time: 1, feedback: 0, mix: 1 } });
function fixture() {
	return createSoundscaperProject({ id: 'muted-release', title: 'Muted release', now: '2026-10-10T00:00:00.000Z',
		tracks: ['dry', 'delayed'].map(id => createAudioTrack({ id, name: id, clipIds: [`${id}-clip`],
			effects: id === 'delayed' ? [delay] : [] })),
		sources: [createAudioSource({ id: 'recording', name: 'Recording', storageKey: 'recording',
			sampleRate: RATE, channelCount: 2, frameCount: RATE })],
		clips: ['dry', 'delayed'].map(id => createAudioClip({ id: `${id}-clip`, sourceId: 'recording',
			durationFrames: RATE, sourceDurationFrames: RATE, timelineStartFrame: 0 })),
	});
}

for (const control of ['mute', 'gain', 'solo', 'vca'] as const) {
	test(`Export includes no post-fader tail silenced by ${control}`, () => {
		const project = fixture();
		const muted = { ...project,
			tracks: project.tracks.map(track => ({ ...track,
				...(track.id === 'delayed' && control === 'mute' ? { mute: true } : {}),
				...(track.id === 'delayed' && control === 'gain' ? { gain: 0 } : {}),
				...(track.id === 'dry' && control === 'solo' ? { solo: true } : {}),
			})),
			mixer: { ...project.mixer, vcas: control === 'vca'
				? [{ id: 'control', name: 'Control', gain: 1, mute: true, members: [{ kind: 'track' as const, id: 'delayed' }] }]
				: project.mixer.vcas },
		};
		assert.equal(projectEffectTailFrames(muted), 0);
		assert.equal(createExportPlan(muted).tailFrames, 0);
		assert.equal(resolveRenderTailSeconds(muted as unknown as EngineProject, true), 0);
	});
}

test('ungated stem and neutral track render retain a muted recording release', () => {
	const project = fixture();
	const muted = { ...project, tracks: project.tracks.map(track => ({ ...track, mute: true })) };
	assert.equal(createExportPlan(muted, { mode: 'stems' }).tailFrames, RATE);
	assert.equal(resolveRenderTailSeconds(muted as unknown as EngineProject, true,
		{ respectMuteSolo: false, trackId: 'delayed', includeMaster: false }), 1);
});

for (const parameterId of ['mute', 'gain'] as const) {
	test(`an automated ${parameterId} can reopen a statically silent insert`, () => {
		const project = fixture();
		const address: ParameterAddress = { kind: 'strip', strip: { kind: 'track', id: 'delayed' }, parameterId };
		const automated = { ...project,
			tracks: project.tracks.map(track => ({ ...track,
				...(track.id === 'delayed' ? parameterId === 'mute' ? { mute: true } : { gain: 0 } : {}) })),
			automationLanes: [{ id: 'audible', address, timebase: 'absolute-samples' as const,
				points: [{ id: 'start', position: 0, value: parameterId === 'mute' ? 0 : 1 }], segments: [] }],
		};
		assert.equal(projectEffectTailFrames(automated), RATE);
	});
}

test('a muted track pre-fader send still releases its audible insert', () => {
	const project = fixture();
	const edges = project.mixer.edges.map(edge => edge.source.kind === 'track' && edge.source.id === 'delayed'
		? { ...edge, kind: 'send' as const, position: 'pre-fader' as const } : edge);
	const muted = { ...project, tracks: project.tracks.map(track => ({ ...track, mute: track.id === 'delayed' })),
		mixer: { ...project.mixer, edges } };
	assert.equal(projectEffectTailFrames(muted), RATE);
});

for (const position of ['pre-fader', 'post-fader'] as const) {
	test(`a muted parallel group excludes only its ${position} terminal path`, () => {
		const project = fixture();
		const bus = { id: 'parallel', name: 'Parallel', color: '#000000', gain: 1, pan: 0,
			mute: true, solo: false, collapsed: false, effectsActive: true, channelCount: 2,
			effects: [createEffect('delay', { params: { time: 2, feedback: 0, mix: 1 } })] };
		const edge = { id: 'parallel-feed', kind: 'send' as const,
			source: { kind: 'track' as const, id: 'delayed' }, destination: { kind: 'mixer-node' as const, id: bus.id },
			position: 'post-fader' as const, level: 1, enabled: true, channelMap: [0, 1] };
		const parallel = { ...project, mixer: { ...project.mixer, groups: [bus], edges: [...project.mixer.edges, edge,
			{ ...edge, id: 'parallel-output', kind: 'assignment' as const,
				source: { kind: 'mixer-node' as const, id: bus.id }, destination: { kind: 'master' as const }, position }] } };
		assert.equal(projectEffectTailFrames(parallel), position === 'pre-fader' ? 3 * RATE : RATE);
	});
}

for (const field of ['mute', 'gain'] as const) {
	test(`Master ${field} gates release only when master processing is included`, () => {
		const project = fixture();
		const silent = { ...project, master: { ...project.master, [field]: field === 'mute' ? true : 0 } };
		assert.equal(projectEffectTailFrames(silent), 0);
		assert.equal(projectEffectTailFrames(silent, { includeMaster: false }), RATE);
	});
}

test('zero routing level excludes a release unless its authored automation can reopen it', () => {
	const project = fixture();
	const delayedEdge = project.mixer.edges.find(edge => edge.source.kind === 'track' && edge.source.id === 'delayed')!;
	const silent = { ...project, mixer: { ...project.mixer,
		edges: project.mixer.edges.map(edge => edge.id === delayedEdge.id ? { ...edge, level: 0 } : edge) } };
	assert.equal(projectEffectTailFrames(silent), 0);
	const address: ParameterAddress = { kind: 'edge', edgeId: delayedEdge.id, parameterId: 'level' };
	const automated = { ...silent, automationLanes: [{ id: 'routing', address, timebase: 'absolute-samples' as const,
		points: [{ id: 'open', position: 0, value: 1 }], segments: [] }] };
	assert.equal(projectEffectTailFrames(automated), RATE);
});
