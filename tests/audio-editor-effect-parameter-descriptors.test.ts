/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	effectParameterInventory,
	stripParameterDescriptor,
} from '../src/common/editor/effect-parameter-descriptors.ts';
import { createEffect } from '../src/common/editor/effects.js';

const TRACK = Object.freeze({ kind: 'track' as const, id: 'track-1' });

test('strip and edge descriptors expose the exact schema-neutral inventory', () => {
	const descriptors = [
		stripParameterDescriptor({ kind: 'strip', strip: TRACK, parameterId: 'gain' }, 12),
		stripParameterDescriptor({ kind: 'strip', strip: TRACK, parameterId: 'pan' }, 12),
		stripParameterDescriptor({ kind: 'strip', strip: TRACK, parameterId: 'mute' }, 12),
		stripParameterDescriptor({ kind: 'edge', edgeId: 'edge-1', parameterId: 'level' }, 24),
	];
	assert.deepEqual(descriptors.map((descriptor) => ({
		kind: descriptor.address.kind,
		parameterId: descriptor.address.parameterId,
		minimum: descriptor.minimum,
		maximum: descriptor.maximum,
		defaultValue: descriptor.defaultValue,
		latencyFrames: descriptor.latencyFrames,
	})), [
		{ kind: 'strip', parameterId: 'gain', minimum: 0, maximum: 4, defaultValue: 1, latencyFrames: 12 },
		{ kind: 'strip', parameterId: 'pan', minimum: -1, maximum: 1, defaultValue: 0, latencyFrames: 12 },
		{ kind: 'strip', parameterId: 'mute', minimum: 0, maximum: 1, defaultValue: 0, latencyFrames: 12 },
		{ kind: 'edge', parameterId: 'level', minimum: 0, maximum: 4, defaultValue: 1, latencyFrames: 24 },
	]);
});

test('built-in descriptors derive range metadata from their owning definitions', () => {
	const effect = createEffect('highpass', {
		id: 'filter-1',
		params: { frequency: 120, q: 1 },
	});
	const inventory = effectParameterInventory(TRACK, effect);
	assert.equal(inventory.revisionInputs.length, 0);
	assert.deepEqual(inventory.descriptors.map((descriptor) => ({
		parameterId: descriptor.address.kind === 'effect' ? descriptor.address.parameterId : null,
		unit: descriptor.unit,
		minimum: descriptor.minimum,
		maximum: descriptor.maximum,
		defaultValue: descriptor.defaultValue,
		taper: descriptor.taper,
		automatable: descriptor.automatable,
	})), [
		{
			parameterId: 'frequency', unit: 'Hz', minimum: 10, maximum: 20_000,
			defaultValue: 80, taper: 'logarithmic', automatable: true,
		},
		{
			parameterId: 'q', unit: 'Q', minimum: 0.1, maximum: 30,
			defaultValue: 0.707, taper: 'logarithmic', automatable: true,
		},
	]);
});

test('effect and element IDs keep descriptors stable across reorder and reload', () => {
	const original = createEffect('eq', {
		id: 'eq-1',
		params: {
			outputGain: 0,
			bands: [
				{ id: 'low', enabled: true, type: 'peaking', frequency: 120, gain: 1, q: 1, slope: 12 },
				{ id: 'high', enabled: true, type: 'peaking', frequency: 8_000, gain: -1, q: 1, slope: 12 },
			],
		},
	});
	const reordered = createEffect('eq', {
		...structuredClone(original),
		params: {
			...structuredClone(original.params),
			bands: [...original.params.bands].reverse(),
		},
	});
	const keys = (effect: ReturnType<typeof createEffect>) => effectParameterInventory(TRACK, effect)
		.descriptors.map((descriptor) => descriptor.id).sort();
	assert.deepEqual(keys(original), keys(reordered));

	const lowGain = effectParameterInventory(TRACK, original).descriptors.find((descriptor) => (
		descriptor.address.kind === 'effect'
		&& descriptor.address.elementId === 'low'
		&& descriptor.address.parameterId === 'gain'
	));
	assert.ok(lowGain);
	assert.equal(lowGain.defaultValue, 0);
	assert.equal(lowGain.unit, 'dB');
});

test('Audacity scalar descriptors retain manifest ranges and block latency-changing parameters', () => {
	const effect = createEffect('audacity-compressor', { id: 'compressor-1' });
	const inventory = effectParameterInventory(TRACK, effect, { sampleRate: 48_000 });
	const threshold = inventory.descriptors.find((descriptor) => (
		descriptor.address.kind === 'effect' && descriptor.address.parameterId === 'thresholdDb'
	));
	const lookahead = inventory.descriptors.find((descriptor) => (
		descriptor.address.kind === 'effect' && descriptor.address.parameterId === 'lookaheadMs'
	));
	assert.deepEqual({
		minimum: threshold?.minimum,
		maximum: threshold?.maximum,
		defaultValue: threshold?.defaultValue,
		unit: threshold?.unit,
		step: threshold?.step,
		automatable: threshold?.automatable,
	}, {
		minimum: -60, maximum: 0, defaultValue: -10, unit: 'dB', step: 0.1, automatable: true,
	});
	assert.equal(lookahead?.automatable, false);
	assert.match(lookahead?.automationBlockReason || '', /latency/iu);
});

test('compound parameters without stable element IDs become explicit 4A revision inputs', () => {
	const effect = createEffect('audacity-filter-curve-eq', { id: 'curve-1' });
	const inventory = effectParameterInventory(TRACK, effect);
	assert.equal(inventory.descriptors.some((descriptor) => (
		descriptor.address.kind === 'effect' && descriptor.address.parameterId === 'points'
	)), false);
	assert.deepEqual(inventory.revisionInputs, [{
		effectId: 'curve-1',
		parameterId: 'points',
		reason: 'Curve points need persisted stable element IDs before they can be automated.',
	}]);
});
