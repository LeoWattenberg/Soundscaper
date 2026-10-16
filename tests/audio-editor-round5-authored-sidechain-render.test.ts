/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createIsolatedTrackRenderProjectV21 } from '../src/common/editor/controller/shared/isolated-track-render-project-v21.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { createHarness } from './audio-editor-effect-audio-service-fixture.ts';
import type { EffectAudioProject } from '../src/common/editor/controller/effects/internal/effect-audio-service-types.ts';
import { validateMixerGraphV21, type MixerEdgeV21, type MixerGraphV21, type MixerStripV21 } from '../src/common/editor/mixer-graph-v21.ts';

function fixture(mode: 'track' | 'bus' | 'master' | 'disabled' = 'track') {
	const programme = createAudioTrack({ id: 'programme', name: 'Programme', gain: 0.75, pan: 0.75,
		clipIds: [], effects: [createEffect('gate', { id: 'gate' })] });
	const detector = createAudioTrack({ id: 'detector', name: 'Detector', gain: 0.25,
		pan: -0.5, clipIds: [], effects: [createEffect('delay', { id: 'detector-gain' })] });
	const other = createAudioTrack({ id: 'unrelated', name: 'Other', clipIds: [] });
	const project = createSoundscaperProject({ id: 'authored-capture', title: 'Capture',
		now: '2026-10-08T12:00:00.000Z', tracks: [programme, detector, other] });
	const mixer = project.mixer as unknown as MixerGraphV21;
	const bus: MixerStripV21 = { id: 'control-bus', name: 'Control bus', color: '#ffffff',
		channelCount: 2, gain: 0.5, pan: 0.1, mute: false, solo: false, collapsed: false,
		effectsActive: true, effects: [createEffect('delay', { id: 'bus-gain' })] };
	const sidechain: MixerEdgeV21 = { id: 'detector-feed', kind: 'sidechain',
		source: mode === 'bus' ? { kind: 'mixer-node', id: bus.id }
			: mode === 'master' ? { kind: 'master' } : { kind: 'track', id: detector.id },
		destination: { kind: 'effect-sidechain', strip: { kind: 'track', id: programme.id }, effectId: 'gate' },
		position: 'post-fader', level: 0.5, enabled: mode !== 'disabled', channelMap: [1, 0] };
	const graph: MixerGraphV21 = { ...mixer, groups: mode === 'bus' ? [bus] : [],
		vcas: [{ id: 'ride', name: 'Ride', gain: 0.5, mute: false,
			members: [{ kind: 'track', id: programme.id }, { kind: 'track', id: detector.id }] }],
		edges: [...mixer.edges.filter(edge => !(mode === 'master' && edge.source.kind === 'track'
			&& edge.source.id === programme.id)),
			...(mode === 'master' ? [{ ...mixer.edges[0]!, source: { kind: 'track' as const, id: programme.id },
				destination: { kind: 'output' as const, id: 'main' } }] : []),
			...(mode === 'bus' ? [{ id: 'control-send', kind: 'send' as const,
				source: { kind: 'track' as const, id: detector.id }, destination: { kind: 'mixer-node' as const, id: bus.id },
				position: 'pre-fader' as const, level: 0.25, enabled: true, channelMap: [0, 1] }] : []), sidechain] };
	const lane = (id: string, address: Parameters<typeof normalizeAutomationLaneV21>[0]) =>
		normalizeAutomationLaneV21({ id, address, timebase: 'absolute-samples',
			points: [{ id: `${id}-point`, position: 0, value: 0.5 }], segments: [] });
	const automationLanes = [
		lane('programme-gain', { kind: 'strip', strip: { kind: 'track', id: programme.id }, parameterId: 'gain' }),
		lane('programme-pan', { kind: 'strip', strip: { kind: 'track', id: programme.id }, parameterId: 'pan' }),
		lane('detector-gain', { kind: 'strip', strip: { kind: 'track', id: detector.id }, parameterId: 'gain' }),
		lane('detector-edge', { kind: 'edge', edgeId: sidechain.id, parameterId: 'level' }),
	];
	validateMixerGraphV21(graph, { audioTracks: [programme, detector, other], masterEffects: [], masterChannels: 2 });
	return { project: { ...project, mixer: graph, automationLanes }, sidechain, detector, bus };
}

for (const mode of ['track', 'bus', 'master', 'disabled'] as const) {
	test(`authored ${mode} detector stays connected while only the programme reaches the capture`, async () => {
		const { project, sidechain, detector, bus } = fixture(mode);
		const before = structuredClone(project);
		const capture = createIsolatedTrackRenderProjectV21(project as never, {
			trackId: 'programme', effects: [], preserveTrackProcessing: true,
		});
		assert.deepEqual(capture.mixer.edges.find(edge => edge.id === sidechain.id), sidechain);
		assert.deepEqual(capture.tracks.find(track => track.id === detector.id)?.effects, detector.effects);
		if (mode === 'bus') assert.deepEqual(capture.mixer.groups, [bus]);
		if (mode !== 'master') assert.deepEqual(capture.tracks.map(track => track.id), ['programme', 'detector']);
		assert.equal(capture.tracks.find(track => track.id === 'programme')?.pan, 0);
		assert.deepEqual(capture.mixer.vcas[0]?.members, [{ kind: 'track', id: detector.id }]);
		assert.ok(capture.automationLanes.some(lane => (lane as { id: string }).id === 'detector-edge'));
		assert.equal(capture.automationLanes.some(lane => (lane as { id: string }).id === 'programme-pan'), false);
		const audible = capture.mixer.edges.filter(edge => edge.destination.kind === 'output' && edge.level !== 0);
		assert.equal(audible.length, 1);
		assert.deepEqual(audible[0]?.source, { kind: 'track', id: 'programme' });
		assert.equal(audible[0]?.position, 'pre-fader');
		assert.equal(audible[0]?.level, 0.75);
		const gain = capture.automationLanes.find(lane => (lane as { id: string }).id === 'programme-gain');
		assert.ok(gain);
		assert.deepEqual(normalizeAutomationLaneV21(gain), {
			...project.automationLanes[0], address: { kind: 'edge', edgeId: audible[0]!.id, parameterId: 'level' },
		});
		assert.deepEqual(project, before);
		const engine = createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null });
		try { assert.doesNotThrow(() => engine.loadProject(capture, new Map())); }
		finally { await engine.dispose(); }
	});
}

test('dry capture keeps its neutral one-track contract despite authored detector routing', () => {
	const { project } = fixture('bus');
	const capture = createIsolatedTrackRenderProjectV21(project as never, { trackId: 'programme', effects: [] });
	assert.deepEqual(capture.tracks.map(track => track.id), ['programme']);
	assert.deepEqual(capture.automationLanes, []);
	assert.equal(capture.mixer.edges.some(edge => edge.kind === 'sidechain'), false);
	assert.deepEqual(capture.tracks[0]?.effects, []);
});

for (const processing of ['dry', 'authored'] as const) {
	test(`${processing} service selects the graph render contract its detector context needs`, async () => {
		const { project } = fixture('bus');
		const harness = createHarness({ project: project as unknown as EffectAudioProject });
		await harness.service.renderDryTrackRange('programme', 0, 8, 1, null, null, processing);
		assert.deepEqual(harness.renderRequests.map(({ trackId, includeMaster, includeTrackPan }) =>
			({ trackId, includeMaster, includeTrackPan })), [{
			trackId: processing === 'authored' ? null : 'programme',
			includeMaster: processing === 'authored', includeTrackPan: processing === 'authored',
		}]);
	});
}

test('a detector rack retains its own transitive sidechain without an unrelated output mix', () => {
	const { project, sidechain } = fixture('bus');
	const detectorGate = createEffect('gate', { id: 'detector-gate' });
	const nested: MixerEdgeV21 = { ...sidechain, id: 'nested-detector',
		source: { kind: 'track', id: 'unrelated' }, destination: { kind: 'effect-sidechain',
			strip: { kind: 'track', id: 'detector' }, effectId: 'detector-gate' } };
	const authored = { ...project, tracks: project.tracks.map(track => track.id === 'detector'
		? { ...track, effects: [...(track.effects as readonly Readonly<Record<string, unknown>>[]), detectorGate] } : track),
		mixer: { ...project.mixer, edges: [...project.mixer.edges, nested] } };
	const capture = createIsolatedTrackRenderProjectV21(authored as never, {
		trackId: 'programme', effects: [], preserveTrackProcessing: true,
	});
	assert.deepEqual(capture.tracks.map(track => track.id), ['programme', 'detector', 'unrelated']);
	assert.deepEqual(capture.mixer.edges.find(edge => edge.id === nested.id), nested);
	assert.equal(capture.mixer.edges.filter(edge => edge.destination.kind === 'output' && edge.level > 0).length, 1);
});
