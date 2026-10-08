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

function fixture(mode: 'direct' | 'bus' | 'transitive' | 'none') {
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
				gain: 0.5, pan: 0.75, effects: [createEffect('gate', { id: 'gate' })] },
			{ id: 'detector-track', type: 'audio', name: 'Detector', clipIds: ['detector'],
				effects: mode === 'transitive' ? [createEffect('gate', { id: 'detector-gate' })] : [] },
			{ id: 'second-track', type: 'audio', name: 'Second detector', clipIds: ['second-detector'] },
		],
	});
	const detector: MixerEdgeV21 = { id: 'detector-edge', kind: 'sidechain',
		source: mode === 'bus' ? { kind: 'mixer-node', id: 'detector-bus' } : { kind: 'track', id: 'detector-track' },
		destination: { kind: 'effect-sidechain', strip: { kind: 'track', id: 'programme-track' }, effectId: 'gate' },
		position: 'pre-fader', level: 0.75, enabled: true, channelMap: [0] };
	const mixer = normalizeMixerGraphV21({ ...project.mixer,
		groups: mode === 'bus' ? [{ id: 'detector-bus', name: 'Detector bus', channelCount: 1,
			color: '#ffffff', gain: 1, pan: 0, mute: false, solo: false, collapsed: false, effectsActive: true, effects: [] }] : [],
		edges: [...project.mixer.edges, ...(mode === 'none' ? [] : [detector]),
			...(mode === 'bus' ? [{ id: 'bus-feed', kind: 'send' as const,
				source: { kind: 'track' as const, id: 'detector-track' },
				destination: { kind: 'mixer-node' as const, id: 'detector-bus' },
				position: 'pre-fader' as const, level: 0.5, enabled: true, channelMap: [0] },
				{ id: 'bus-output', kind: 'assignment' as const,
					source: { kind: 'mixer-node' as const, id: 'detector-bus' }, destination: { kind: 'master' as const },
				position: 'post-fader' as const, level: 1, enabled: true, channelMap: [0, 0] }] : []),
			...(mode === 'transitive' ? [{ ...detector, id: 'second-edge', source: { kind: 'track' as const, id: 'second-track' },
				destination: { kind: 'effect-sidechain' as const, strip: { kind: 'track' as const, id: 'detector-track' }, effectId: 'detector-gate' } }] : [])],
	});
	const lane = normalizeAutomationLaneV21({ id: 'detector-gain', address: {
		kind: 'strip', strip: { kind: 'track', id: 'detector-track' }, parameterId: 'gain',
	}, timebase: 'absolute-samples', points: [{ id: 'gain-point', position: 0, value: 0.5 }], segments: [] });
	return createSoundscaperProject({ ...project, mixer, automationLanes: [lane] });
}

for (const mode of ['direct', 'bus', 'transitive', 'none'] as const) {
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
		assert.deepEqual(snapshot.mixer, stem.mixer);
		assert.deepEqual(snapshot.automationLanes, stem.automationLanes);
		assert.deepEqual(authored, before);
		const engine = createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null });
		try { assert.doesNotThrow(() => engine.loadProject(snapshot, new Map())); }
		finally { await engine.dispose(); }
	});
}
