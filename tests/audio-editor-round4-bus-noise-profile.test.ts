/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffectControlsService, type EffectControlsState } from '../src/common/editor/controller/effects/effect-controls-service.ts';
import { createBusNoiseProfileRenderProject } from '../src/common/editor/controller/effects/internal/bus-noise-profile-render-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { validateMixerGraphV21, type MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createHarness } from './audio-editor-effect-audio-service-fixture.ts';

test('rack profile capture retains the group or send owner selected through Mixer', async () => {
	const effect = { id: 'noise', type: 'audacity-noise-reduction', params: {}, enabled: false };
	const state: EffectControlsState = {
		audacityEffectType: effect.type, audacityEffectParams: {}, audacityEffectTouchedParams: new Map(),
		audacityPreviewSource: null, audacityPreviewAuditionBandId: null, audacityPreviewGeneration: 0,
		audacityControlTrackId: null, effectPresets: { schemaVersion: 1, presets: [] }, lastAudacityEffect: null,
	};
	const project = { id: 'session', tracks: [], master: { effects: [] },
		mixer: { groups: [{ id: 'group', effects: [effect] }], sends: [{ id: 'send', effects: [effect] }] } };
	const captures: unknown[] = [];
	const service = createEffectControlsService({ state, getProject: () => project,
		copy: { audacitySelectionHint: 'Select audio', controlTrackNotFound: 'Missing control',
			rackEffectNotFound: 'Missing rack effect', ready: 'Ready', selectionEffectUnsupported: 'Unsupported' },
		createId: () => 'preset', persistSetting: async () => undefined, publishDocumentSnapshot() {}, setStatus() {},
		applySelectedAudacityEffect: async () => undefined,
		captureRackNoiseProfile: async (candidate, scope, id) => { captures.push({ candidate, scope, id }); },
	});
	await service.captureRackNoiseProfileFromController('group', 'group', effect.id);
	await service.captureRackNoiseProfileFromController('send', 'send', effect.id);
	assert.deepEqual(captures, [{ candidate: effect, scope: 'group', id: 'group' },
		{ candidate: effect, scope: 'send', id: 'send' }]);
});

function busProject(scope: 'group' | 'send') {
	const base = createSoundscaperProject({ id: 'bus-profile',
		tracks: [createAudioTrack({ id: 'track-a', clipIds: [] }), createAudioTrack({ id: 'other', clipIds: [] })],
		sequences: [{ id: 'main', trackIds: ['track-a', 'other'] }], primarySequenceId: 'main' });
	const withBus = applySoundscaperProjectCommand(base, {
		type: 'mixer/bus-add', busType: scope, bus: { id: 'bus', name: 'Group bus' },
	});
	const effect = createEffect('audacity-noise-reduction', { id: 'noise', enabled: false });
	const prefix = createEffect('audacity-reverb', { id: 'before' });
	const suffix = createEffect('audacity-reverb', { id: 'after' });
	const field = scope === 'group' ? 'groups' : 'sends';
	const project = applySoundscaperProjectCommand(withBus, { type: 'mixer-graph/set', expected: withBus.mixer,
		mixer: { ...withBus.mixer, [field]: withBus.mixer[field].map(bus => ({ ...bus, gain: 0.4, pan: 0.5,
			effects: [prefix, effect, suffix], effectsActive: true })),
			edges: [...withBus.mixer.edges.filter(edge => edge.id !== 'assignment:track:track-a:master'),
				{ id: 'input', kind: scope === 'send' ? 'send' : 'assignment', source: { kind: 'track', id: 'track-a' },
					destination: { kind: 'mixer-node', id: 'bus' }, position: 'post-fader', level: 0.75,
					enabled: true, channelMap: [] }] },
	});
	return { project, effect };
}

for (const scope of ['group', 'send'] as const) {
	test(`${scope} profiling preserves upstream routing and isolates its pre-fader effect prefix`, () => {
		const { project, effect } = busProject(scope);
		const original = structuredClone(project);
		const capture = createBusNoiseProfileRenderProject(project, effect, scope, 'bus');
		const mixer = capture.mixer as unknown as MixerGraphV21;
		const bus = mixer[scope === 'group' ? 'groups' : 'sends'][0]!;
		assert.deepEqual(bus.effects.map(candidate => candidate.id), ['before']);
		assert.equal(bus.gain, 1);
		assert.equal(bus.pan, 0);
		assert.equal(mixer.edges.find(edge => edge.id === 'input')?.level, 0.75);
		assert.equal(mixer.edges.find(edge => edge.id === 'assignment:track:other:master')?.level, 0);
		assert.equal(mixer.edges.filter(edge => edge.destination.kind === 'master' && edge.level > 0).length, 1);
		validateMixerGraphV21(mixer, { audioTracks: project.tracks.filter(track => track.type === 'audio'),
			masterChannels: capture.masterChannels, masterEffects: capture.master.effects });
		assert.deepEqual(project, original);
	});
	test(`${scope} profiling publishes a single update to its real rack owner`, async () => {
		const { project, effect } = busProject(scope);
		const harness = createHarness({ project });
		harness.setSelection({ startFrame: 100, endFrame: 4_100, trackIds: ['track-a'], clipIds: [] });
		await harness.service.captureRackNoiseProfile(effect, scope, 'bus');
		assert.equal(harness.commands.length, 1);
		assert.deepEqual(harness.commands[0], { type: 'effect/update', scope, trackId: 'bus', busId: 'bus',
			effectId: effect.id, changes: { enabled: true, context: { noiseProfile: { serialized: { bins: [1, 2] } } } } });
		assert.equal(harness.noiseProfileWorkerChannels[0]?.length, 2);
		assert.equal(harness.prefixDisposals, 1);
	});
}
