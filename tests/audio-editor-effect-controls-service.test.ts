/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEffectControlsService,
	type EffectControlsState,
	type EffectPresetCollection,
} from '../src/common/editor/controller/effect-controls-service.ts';

function createHarness() {
	const configured: unknown[] = [];
	const persistence: Array<readonly [string, EffectPresetCollection, string]> = [];
	const statuses: string[] = [];
	let applied = 0;
	let captured: unknown = null;
	let publications = 0;
	const preview = {
		onended: () => undefined,
		onerror: () => undefined,
		stopCalls: 0,
		disconnectCalls: 0,
		configure(params: Readonly<Record<string, unknown>>) { configured.push(params); },
		stop() { this.stopCalls += 1; },
		disconnect() { this.disconnectCalls += 1; },
	};
	const state: EffectControlsState = {
		audacityEffectType: 'eq',
		audacityEffectParams: {},
		audacityEffectTouchedParams: new Map(),
		audacityPreviewSource: preview,
		audacityPreviewAuditionBandId: 'band-1',
		audacityPreviewGeneration: 0,
		audacityControlTrackId: null,
		effectPresets: { schemaVersion: 1, presets: [] },
		lastAudacityEffect: null,
	};
	const service = createEffectControlsService({
		state,
		copy: {
			audacityPreviewCancelled: 'Preview cancelled',
			audacitySelectionHint: 'Select audio',
			controlTrackNotFound: 'Control track missing',
			noRepeatableEffect: 'Nothing to repeat',
			rackEffectNotFound: 'Rack effect missing',
			ready: 'Ready',
			selectionEffectUnsupported: 'Unsupported effect',
		},
		createId: () => 'preset-1',
		getProject: () => ({
			id: 'project-a',
			tracks: [{
				id: 'track-a', type: 'audio', effects: [{ id: 'effect-a', type: 'audacity-noise-reduction' }],
			}],
			master: { effects: [] },
		}),
		persistSetting: async (key, value, options) => {
			persistence.push([key, value, options.policy]);
			return value;
		},
		publishDocumentSnapshot: () => { publications += 1; },
		setStatus: (message) => { statuses.push(message); },
		applySelectedAudacityEffect: async () => { applied += 1; return 'applied'; },
		captureRackNoiseProfile: async (effect, scope, trackId) => {
			captured = { effect, scope, trackId };
			return true;
		},
	});
	return {
		configured,
		get applied() { return applied; },
		get captured() { return captured; },
		get publications() { return publications; },
		persistence,
		preview,
		service,
		state,
		statuses,
	};
}

test('parameter changes normalize once, configure EQ preview, and track touched controls', () => {
	const harness = createHarness();
	const params = harness.service.setAudacityEffectParamsFromController({ bands: [] });
	assert.ok(Array.isArray(params.bands));
	assert.equal(harness.configured.length, 1);
	assert.deepEqual([...harness.state.audacityEffectTouchedParams.get('eq') ?? []], ['bands']);
	assert.equal(harness.publications, 1);
});

test('untouched Amplify gain derives Audacity-compatible headroom from the selection peak', () => {
	const harness = createHarness();
	harness.state.audacityEffectType = 'audacity-amplify';
	const resolved = harness.service.resolveInteractiveAudacityParams(
		'audacity-amplify',
		harness.service.currentAudacityEffectParams(),
		[new Float32Array([0.25, -0.5])],
	);
	assert.ok(Math.abs(Number(resolved.gainDb) - 6.0206) < 0.001);
	harness.state.audacityEffectTouchedParams.set('audacity-amplify', new Set(['gainDb']));
	assert.equal(harness.service.resolveInteractiveAudacityParams(
		'audacity-amplify', { gainDb: -3 }, [new Float32Array([0.1])],
	).gainDb, -3);
});

test('preset writes are required and become visible through the same state owner', async () => {
	const harness = createHarness();
	harness.service.setAudacityEffectType('audacity-amplify');
	const preset = await harness.service.saveEffectPreset({ name: 'Normalize-ish', now: '2025-01-01T00:00:00Z' });
	assert.equal(preset.id, 'preset-1');
	assert.equal(harness.persistence.length, 1);
	assert.deepEqual(harness.persistence[0]?.slice(0, 2), [
		'audio-editor-effect-presets-v1',
		harness.state.effectPresets,
	]);
	assert.equal(harness.persistence[0]?.[2], 'required');
	assert.equal(harness.service.applyEffectPreset('preset-1').effectType, 'audacity-amplify');
	assert.ok((harness.state.audacityEffectTouchedParams.get('audacity-amplify')?.size ?? 0) > 0);
});

test('controller apply cancels a preview before changing effect configuration', async () => {
	const harness = createHarness();
	assert.equal(await harness.service.applyAudacityEffectFromController({
		type: 'audacity-amplify', params: { gainDb: 3 }, controlTrackId: 'track-a',
	}), 'applied');
	assert.equal(harness.applied, 1);
	assert.equal(harness.preview.stopCalls, 1);
	assert.equal(harness.preview.disconnectCalls, 1);
	assert.equal(harness.state.audacityControlTrackId, 'track-a');
	assert.equal(harness.state.audacityEffectParams['audacity-amplify']?.gainDb, 3);
});

test('repeat and rack profile adapters preserve public action behavior', async () => {
	const harness = createHarness();
	await assert.rejects(() => harness.service.repeatLastAudacityEffect(), /Nothing to repeat/u);
	harness.state.lastAudacityEffect = {
		type: 'audacity-amplify', params: { gainDb: -2 }, controlTrackId: 'track-a',
	};
	assert.equal(await harness.service.repeatLastAudacityEffect(), 'applied');
	assert.equal(harness.state.audacityEffectParams['audacity-amplify']?.gainDb, -2);
	assert.equal(await harness.service.captureRackNoiseProfileFromController('track', 'track-a', 'effect-a'), true);
	assert.deepEqual(harness.captured, {
		effect: { id: 'effect-a', type: 'audacity-noise-reduction' }, scope: 'track', trackId: 'track-a',
	});
});

test('preview cancellation is idempotent and invalidates late callbacks', () => {
	const harness = createHarness();
	assert.equal(harness.service.cancelAudacityEffectPreview(), true);
	assert.equal(harness.state.audacityPreviewGeneration, 1);
	assert.equal(harness.state.audacityPreviewSource, null);
	assert.equal(harness.state.audacityPreviewAuditionBandId, null);
	assert.equal(harness.service.cancelAudacityEffectPreview(), false);
	assert.equal(harness.statuses.at(-1), 'Preview cancelled');
});

test('preset import, export, and deletion round-trip through required storage', async () => {
	const harness = createHarness();
	harness.service.setAudacityEffectType('audacity-amplify');
	await harness.service.saveEffectPreset('Portable');
	const exported = harness.service.exportEffectPreset('preset-1');
	assert.match(exported, /Portable/u);
	assert.equal(await harness.service.deleteEffectPreset('preset-1'), true);
	assert.equal(harness.state.effectPresets.presets.length, 0);
	const imported = await harness.service.importEffectPresets(exported);
	assert.equal(imported.length, 1);
	assert.equal(imported[0]?.id, 'preset-1');
	assert.equal(harness.persistence.length, 3);
});

test('invalid controller targets fail synchronously and silent preview cancellation can skip publication', async () => {
	const harness = createHarness();
	assert.throws(() => harness.service.setAudacityEffectType('not-an-effect'), /Unsupported/u);
	assert.throws(() => harness.service.setAudacityControlTrack('missing'), /Control track missing/u);
	assert.throws(
		() => harness.service.captureRackNoiseProfileFromController('master', null, 'missing'),
		/Rack effect missing/u,
	);
	const publications = harness.publications;
	harness.service.cancelAudacityEffectPreview({ publish: false });
	assert.equal(harness.publications, publications);
	await harness.service.applyAudacityEffectFromController();
	assert.equal(harness.applied, 1);
});
