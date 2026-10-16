/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffect } from '../src/common/editor/effects.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { normalizeMixerGraphV21, type MixerEdgeV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { createExportClipProject } from '../src/common/editor/export-clips.ts';
import { stemProject } from '../src/common/editor/controller/export/temporary-export.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';

function fixture(mode: 'direct' | 'bus' | 'programme-bus' | 'transitive' | 'none') {
	const project = createSoundscaperProject({ id: 'clip-detector', sampleRate: 48_000,
		sources: ['programme-source', 'detector-source', 'second-source'].map(id => ({
			id, storageKey: id, sampleRate: 48_000, frameCount: 48_000, channelCount: 1,
		})),
		clips: [
			{ id: 'programme', sourceId: 'programme-source', timelineStartFrame: 0, durationFrames: 48_000 },
			{ id: 'neighbour', sourceId: 'programme-source', timelineStartFrame: 0, durationFrames: 48_000 },
			{ id: 'detector', sourceId: 'detector-source', timelineStartFrame: 0, durationFrames: 48_000 },
			{ id: 'second-detector', sourceId: 'second-source', timelineStartFrame: 0, durationFrames: 48_000 },
		],
		tracks: [
			{ id: 'programme-track', type: 'audio', name: 'Programme', clipIds: ['programme', 'neighbour'],
				gain: 0.5, pan: 0.75, effects: mode === 'programme-bus' ? [] : [createEffect('gate', { id: 'gate' })] },
			{ id: 'detector-track', type: 'audio', name: 'Detector', clipIds: ['detector'],
				effects: mode === 'transitive' ? [createEffect('gate', { id: 'detector-gate' })] : [] },
			{ id: 'second-track', type: 'audio', name: 'Second detector', clipIds: ['second-detector'] },
		],
	});
	const detector: MixerEdgeV21 = { id: 'detector-edge', kind: 'sidechain',
		source: mode === 'bus' ? { kind: 'mixer-node', id: 'detector-bus' } : { kind: 'track', id: 'detector-track' },
		destination: { kind: 'effect-sidechain', strip: mode === 'programme-bus'
			? { kind: 'mixer-node', id: 'detector-bus' } : { kind: 'track', id: 'programme-track' }, effectId: 'gate' },
		position: 'pre-fader', level: 0.75, enabled: true, channelMap: [0] };
	const mixer = normalizeMixerGraphV21({ ...project.mixer,
		groups: mode === 'bus' || mode === 'programme-bus' ? [{ id: 'detector-bus', name: 'Detector bus', channelCount: 1,
			color: '#ffffff', gain: 0.75, pan: 0.25, mute: false, solo: false, collapsed: false, effectsActive: true,
			effects: mode === 'programme-bus' ? [createEffect('gate', { id: 'gate' })] : [] }] : [],
		edges: [...project.mixer.edges.map(edge => mode === 'programme-bus' && edge.source.kind === 'track'
			&& edge.source.id === 'programme-track' ? { ...edge, destination: { kind: 'mixer-node' as const, id: 'detector-bus' }, channelMap: [0] } : edge),
			...(mode === 'none' ? [] : [detector]),
			...(mode === 'bus' ? [{ id: 'bus-feed', kind: 'send' as const,
				source: { kind: 'track' as const, id: 'detector-track' },
				destination: { kind: 'mixer-node' as const, id: 'detector-bus' },
				position: 'pre-fader' as const, level: 0.5, enabled: true, channelMap: [0] }] : []),
			...(mode === 'bus' || mode === 'programme-bus' ? [{ id: 'bus-output', kind: 'assignment' as const,
					source: { kind: 'mixer-node' as const, id: 'detector-bus' }, destination: { kind: 'master' as const },
				position: 'post-fader' as const, level: 1, enabled: true, channelMap: [0, 0] }] : []),
			...(mode === 'transitive' ? [{ ...detector, id: 'second-edge', source: { kind: 'track' as const, id: 'second-track' },
				destination: { kind: 'effect-sidechain' as const, strip: { kind: 'track' as const, id: 'detector-track' }, effectId: 'detector-gate' } }] : [])],
	});
	const lane = normalizeAutomationLaneV21({ id: 'detector-gain', address: {
		kind: 'strip', strip: { kind: 'track', id: 'detector-track' }, parameterId: 'gain',
	}, timebase: 'absolute-samples', points: [{ id: 'gain-point', position: 0, value: 0.5 }], segments: [] });
	const outputEdge = mode === 'bus' ? 'bus-output' : mixer.edges.find(edge => edge.source.kind === 'track'
		&& edge.source.id === 'detector-track' && edge.destination.kind === 'master')!.id;
	const outputLane = normalizeAutomationLaneV21({ id: 'detector-output-gain', address: {
		kind: 'edge', edgeId: outputEdge, parameterId: 'level',
	}, timebase: 'absolute-samples', points: [{ id: 'output-point', position: 0, value: 0.75 }], segments: [] });
	return createSoundscaperProject({ ...project, mixer, automationLanes: [lane, outputLane] });
}

for (const mode of ['direct', 'bus', 'programme-bus', 'transitive', 'none'] as const) {
	test(`${mode} clip delivery preserves detector content and isolates neighbouring programme clips`, async () => {
		const authored = fixture(mode);
		const before = structuredClone(authored);
		const stem = stemProject(authored, 'programme-track');
		const snapshot = createExportClipProject(stem, { trackId: 'programme-track', clipId: 'programme' });
		const clipIds = mode === 'none' ? ['programme'] : mode === 'transitive'
			? ['programme', 'detector', 'second-detector'] : ['programme', 'detector'];
		assert.deepEqual(snapshot.clips.map(clip => clip.id), clipIds);
		assert.deepEqual(snapshot.tracks.map(track => track.clipIds), [
			['programme'], mode === 'none' ? [] : ['detector'], mode === 'transitive' ? ['second-detector'] : [],
		]);
		assert.equal(snapshot.tracks[0]!.gain, 0.5);
		assert.equal(snapshot.tracks[0]!.pan, 0.75);
		assert.deepEqual(snapshot.tracks[0]!.effects, authored.tracks[0]!.effects);
		for (const edge of snapshot.mixer.edges) {
			const required = edge.source.kind === 'master' || edge.source.kind === 'track' && edge.source.id === 'programme-track'
				|| edge.id === 'detector-edge' || edge.id === 'bus-feed' || edge.id === 'second-edge';
			assert.equal(edge.level, required || mode === 'programme-bus' && edge.id === 'bus-output'
				? stem.mixer.edges.find(original => original.id === edge.id)!.level : 0, `${mode}: ${edge.id} output/control admission`);
		}
		assert.deepEqual(snapshot.mixer.groups, stem.mixer.groups);
		assert.deepEqual(snapshot.automationLanes, stem.automationLanes.filter(lane => lane.id !== 'detector-output-gain'));
		assert.deepEqual(structuredClone(authored), before);
		const engine = createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null });
		try { assert.doesNotThrow(() => engine.loadProject(snapshot, new Map())); }
		finally { await engine.dispose(); }
	});
}
