/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createControllerOwnedStateComposition } from '../src/common/editor/controller/composition/controller-owned-state-composition.ts';
import { createControllerEffectsState } from '../src/common/editor/controller/effects/effects-state.ts';
import type { OwnedStateWriteScope } from '../src/common/editor/controller/shared/owned-state.ts';

interface TestPresets {
	readonly presets: readonly Readonly<{ id: string }>[];
}

test('the effects owner initializes each controller with isolated mutable storage', () => {
	const first = createControllerEffectsState<TestPresets>({
		effectPresets: { presets: [] },
		initialEffectType: 'amplify',
	});
	const second = createControllerEffectsState<TestPresets>({
		effectPresets: { presets: [] },
		initialEffectType: 'amplify',
	});

	first.audacityEffectParams.amplify = { gainDb: 3 };
	first.audacityEffectTouchedParams.set('amplify', new Set(['gainDb']));
	first.rackEffectGestures.set('master:effect', {} as never);

	assert.deepEqual(second.audacityEffectParams, {});
	assert.equal(second.audacityEffectTouchedParams.size, 0);
	assert.equal(second.rackEffectGestures.size, 0);
	assert.notEqual(first.effectMacros, second.effectMacros);
	assert.notEqual(first.macroScripts, second.macroScripts);
});

test('controller composition exposes effects as read-only compatibility fields and a writable owner view', () => {
	const effects = createControllerEffectsState<TestPresets>({
		effectPresets: { presets: [] },
		initialEffectType: 'amplify',
	});
	const owned = createControllerOwnedStateComposition({
		effects,
		preferences: { workspace: 'music' },
		effectPresets: effects.effectPresets,
		initialEffectType: 'amplify',
		phase: 'booting',
		readyMessage: 'Ready',
		mobile: false,
		defaultPixelsPerSecond: 120,
		timelineMinimumSeconds: 30,
		recordingInputGain: 1,
		preferredInputDeviceId: 'default',
	});

	assert.equal(Reflect.set(owned.state, 'audacityEffectProcessing', true), false);
	assert.equal(effects.audacityEffectProcessing, false);
	owned.effectsAccess.audacityEffectProcessing = true;
	owned.effectsAccess.audacityEffectTouchedParams.set('amplify', new Set(['gainDb']));
	assert.equal(owned.state.audacityEffectProcessing, true);
	assert.equal(owned.state.audacityEffectTouchedParams.get('amplify')?.has('gainDb'), true);
	assert.throws(() => Reflect.apply(
		Reflect.get(owned.state.audacityEffectTouchedParams, 'set'),
		owned.state.audacityEffectTouchedParams,
		['eq', new Set()],
	), /read-only/);
	assert.ok(Object.keys(owned.state).includes('audacityEffectProcessing'));
	owned.effectsStatePorts.processing.set(false);
	assert.equal(effects.audacityEffectProcessing, false);
	effects.rackEffectGestures.set('master:effect', {} as never);
	effects.parametricEqGestures.set('track:effect', {} as never);
	effects.nyquistAbort = new AbortController();
	owned.effectsStatePorts.project.beginSwitch();
	assert.equal(effects.rackEffectGestures.size, 0);
	assert.equal(effects.parametricEqGestures.size, 0);
	assert.equal(effects.nyquistAbort, null);
	effects.audacityNoiseProfile = { mean: 0.5 };
	effects.audacityControlTrackId = 'control';
	owned.effectsStatePorts.project.resetScope();
	assert.equal(effects.audacityNoiseProfile, null);
	assert.equal(effects.audacityControlTrackId, null);
	const presets = { presets: [{ id: 'new' }] };
	owned.effectsStatePorts.bootstrap.setEffectPresets(presets);
	assert.equal(effects.effectPresets, presets);
	const worker = {
		onmessage: null,
		onerror: null,
		onmessageerror: null,
		postMessage() {},
		terminate() {},
	};
	effects.audacityEffectWorker = worker;
	assert.equal(owned.effectsStatePorts.runtime.takeSelectionWorker(), worker);
	assert.equal(effects.audacityEffectWorker, null);
	const acceptEffectsWrites = (
		scope: OwnedStateWriteScope<typeof owned.state, typeof effects>,
	) => scope;
	assert.equal(acceptEffectsWrites(owned.effectsAccess), owned.effectsAccess);
	const rejectFlatOrForeignWrites = () => {
		// @ts-expect-error Flat compatibility state carries no effects write capability.
		acceptEffectsWrites(owned.state);
		// @ts-expect-error Recording ownership cannot satisfy an effects write scope.
		acceptEffectsWrites(owned.recordingAccess);
		// @ts-expect-error Transport ownership cannot satisfy an effects write scope.
		acceptEffectsWrites(owned.transportAccess);
	};
	assert.equal(typeof rejectFlatOrForeignWrites, 'function');
});
