/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffectControlsService, type EffectControlsState } from '../src/common/editor/controller/effects/effect-controls-service.ts';

function fixture(controlTrackId: string | null) {
	let applies = 0;
	const state: EffectControlsState = {
		audacityEffectType: 'eq', audacityEffectParams: {}, audacityEffectTouchedParams: new Map(),
		audacityPreviewSource: null, audacityPreviewAuditionBandId: null, audacityPreviewGeneration: 0,
		audacityControlTrackId: 'voice', effectPresets: { schemaVersion: 1, presets: [] },
		lastAudacityEffect: { type: 'audacity-auto-duck', params: {}, controlTrackId },
	};
	const service = createEffectControlsService({ state,
		copy: { controlTrackNotFound: 'Control track missing', audacitySelectionHint: 'Select audio',
			rackEffectNotFound: 'Missing rack', ready: 'Ready', selectionEffectUnsupported: 'Unsupported effect' },
		createId: () => 'preset', getProject: () => ({ id: 'project', tracks: [{ id: 'voice', type: 'audio' }], master: {} }),
		persistSetting: async () => undefined, publishDocumentSnapshot: () => undefined, setStatus: () => undefined,
		applySelectedAudacityEffect: async () => { applies++; return true; }, captureRackNoiseProfile: async () => undefined,
	});
	return { state, service, applied: () => applies };
}

test('Repeat refuses a removed saved detector before using another draft or changing effect configuration', async () => {
	const value = fixture('quiet');
	await assert.rejects(value.service.repeatLastAudacityEffect(), /Control track missing/u);
	assert.equal(value.applied(), 0);
	assert.equal(value.state.audacityEffectType, 'eq');
	assert.deepEqual(value.state.audacityEffectParams, {});
	assert.equal(value.state.audacityControlTrackId, 'voice');
});

test('Repeat restores a saved absent control instead of retaining a subsequent draft control', async () => {
	const value = fixture(null);
	value.state.lastAudacityEffect = { type: 'audacity-invert', params: {}, controlTrackId: null };
	assert.equal(await value.service.repeatLastAudacityEffect(), true);
	assert.equal(value.state.audacityControlTrackId, null);
	assert.equal(value.applied(), 1);
});

test('Repeat retains a surviving saved detector', async () => {
	const value = fixture('voice');
	assert.equal(await value.service.repeatLastAudacityEffect(), true);
	assert.equal(value.state.audacityControlTrackId, 'voice');
	assert.equal(value.applied(), 1);
});
