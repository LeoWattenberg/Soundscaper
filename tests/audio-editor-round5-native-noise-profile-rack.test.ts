/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { captureAudacityNoiseProfile } from '../src/common/editor/audacity-effects/spectral.js';
import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';
import { createRackEffectService, type ControllerRackEffect, type RackEffectControllerState,
	type RackEffectProject } from '../src/common/editor/controller/effects/internal/rack-effect-service.ts';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { initializePffft } from '../src/common/editor/pffft.js';
import { serializeAudacityNoiseProfile } from '../src/common/editor/controller/source/source-audio.ts';

await initializePffft();

function harness(profileRate: number, projectRate = 48_000) {
	const noise = Float32Array.from({ length: 4096 }, (_, frame) => 0.2 * Math.sin(2 * Math.PI * 750 * frame / profileRate));
	const profile = captureAudacityNoiseProfile([noise], profileRate);
	let project = createSoundscaperProject({ id: 'project', sampleRate: projectRate,
		tracks: [createAudioTrack({ id: 'track', clipIds: [] }, projectRate)] });
	const generation = new EditorProjectGeneration(); generation.activate(project.id);
	const state: RackEffectControllerState = { selectedTrackId: 'track', readOnly: false, writeAuthorityGeneration: 0,
		effectClipboard: null, rackEffectGestures: new Map(), parametricEqGestures: new Map(),
		audacityControlTrackId: null, audacityNoiseProfile: profile };
	const statuses: string[] = [];
	const service = createRackEffectService({ state, engine: { sampleRate: projectRate },
		copy: { effectTypeRequired: 'Effect required', selectTrackFirst: 'Track required', audioTrackRequired: 'Audio required',
			effectUnsupported: 'Unsupported', autoDuckOtherControlTrack: 'Control required', noiseReductionAddedDisabled: 'Capture a profile',
			rackEffectNotFound: 'Missing effect', missingEffectReadOnly: 'Read only', projectReadOnly: 'Read only',
			audioTrackNotFound: 'Missing track', paste: 'Paste', noiseProfileMissing: 'Capture a profile' },
		getProject: () => project as unknown as RackEffectProject,
		captureProject: () => generation.capture(project.id), assertProject: token => { generation.assertCurrent(token); },
		editingBlocked: () => false, publishDocumentSnapshot() {}, handleError: error => { throw error; },
		setStatus: message => { statuses.push(message); },
		commit: command => { project = applySoundscaperProjectCommand(project, command); return project as unknown as RackEffectProject; },
	});
	return { service, profile, state, statuses, get effect(): ControllerRackEffect {
		const effect = service.effectStack('track', 'track')[0];
		assert.ok(effect, 'the track must contain the rack effect added by the test');
		return effect;
	} };
}

test('adding a rack rejects automatic reuse of a valid profile captured at another native rate', () => {
	const fixture = harness(24_000);
	fixture.service.addEffect({ type: 'audacity-noise-reduction', scope: 'track', trackId: 'track' });
	assert.equal(fixture.effect.enabled, false);
	assert.equal(fixture.effect.context?.noiseProfile, null);
	assert.deepEqual(fixture.statuses, ['Capture a profile']);
	assert.equal(fixture.state.audacityNoiseProfile, fixture.profile, 'the native selection profile remains available');
});

for (const rate of [24_000, 48_000]) test(`a matching ${rate} Hz profile still enables a playable rack`, () => {
	const fixture = harness(rate, rate);
	fixture.service.addEffect({ type: 'audacity-noise-reduction', scope: 'track', trackId: 'track' });
	assert.equal(fixture.effect.enabled, true);
	assert.doesNotThrow(() => createAudacityLiveProcessor(fixture.effect.type, rate,
		fixture.effect.params, { noiseProfile: fixture.effect.context?.noiseProfile }));
});

test('materializing a source-selection macro retains its native-rate captured profile', () => {
	const fixture = harness(24_000);
	const draft = { type: 'audacity-noise-reduction', enabled: true, params: {},
		context: { noiseProfile: serializeAudacityNoiseProfile(fixture.profile) } };
	const materialized = fixture.service.materializeRackEffect(draft, 'track', 'track', { requireNoiseProfile: true });
	assert.equal(materialized.enabled, true);
	assert.doesNotThrow(() => createAudacityLiveProcessor(materialized.type, 24_000,
		materialized.params, { noiseProfile: materialized.context?.noiseProfile }));
});
