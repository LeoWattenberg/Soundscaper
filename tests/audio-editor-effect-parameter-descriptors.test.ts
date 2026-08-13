/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	effectParameterInventory,
	stripParameterDescriptor,
} from '../src/common/editor/effect-parameter-descriptors.ts';
import { AUDACITY_EFFECT_DEFINITIONS } from '../src/common/editor/audacity-effects/manifest.js';
import {
	AUDIO_EFFECT_DEFINITIONS,
	AUDACITY_RACK_EFFECT_TYPES,
	createEffect,
} from '../src/common/editor/effects.js';

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
	const slopes = effectParameterInventory(TRACK, original).descriptors.filter((descriptor) => (
		descriptor.address.kind === 'effect' && descriptor.address.parameterId === 'slope'
	));
	assert.ok(slopes.length > 0);
	assert.ok(slopes.every((descriptor) => descriptor.step === 12));
});

test('compound descriptor defaults and topology metadata come from owning definitions', () => {
	const definition = AUDIO_EFFECT_DEFINITIONS.eq;
	const effect = createEffect('eq', {
		id: 'eq-owned-metadata',
		params: {
			outputGain: 2,
			bands: [{
				id: 'owned-band', enabled: true, type: 'peaking', frequency: 250,
				gain: 3, q: 2, slope: 24,
			}],
		},
	});
	const inventory = effectParameterInventory(TRACK, effect);
	const owned = (parameterId: string) => parameterDescriptor(inventory, parameterId);
	assert.equal(owned('outputGain').defaultValue, definition.defaults.outputGain);
	assert.equal(owned('enabled').defaultValue, definition.bandDefaults.enabled ? 1 : 0);
	assert.equal(
		owned('type').defaultValue,
		definition.bandTypes.indexOf(definition.bandDefaults.type),
	);
	for (const parameterId of ['frequency', 'gain', 'q'] as const) {
		assert.equal(owned(parameterId).defaultValue, definition.bandDefaults[parameterId]);
	}
	assert.equal(owned('slope').defaultValue, definition.bandDefaults.slope);
	assert.equal(owned('slope').step, definition.bandParameterMetadata.slope.step);
	assert.equal(
		owned('enabled').automationBlockReason,
		definition.bandParameterMetadata.enabled.automationBlockReason,
	);

	const graphicDefinition = AUDACITY_EFFECT_DEFINITIONS['audacity-graphic-eq'].params.gains;
	const graphic = effectParameterInventory(
		TRACK, createEffect('audacity-graphic-eq', { id: 'graphic-owned-metadata' }),
	);
	assert.ok(Array.isArray(graphicDefinition.default));
	assert.deepEqual(
		graphic.descriptors.filter(({ address }) => (
			address.kind === 'effect' && address.parameterId === 'gains'
		)).map(({ defaultValue }) => defaultValue),
		graphicDefinition.default,
	);
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

test('descriptor inventory exactly covers every rack scalar owned by built-in and Audacity definitions', () => {
	const builtIns = Object.entries(AUDIO_EFFECT_DEFINITIONS) as Array<[
		string,
		{ readonly ranges: Readonly<Record<string, unknown>> },
	]>;
	for (const [type, definition] of builtIns) {
		const effect = createEffect(type, { id: `${type}-inventory` });
		const inventory = effectParameterInventory(TRACK, effect);
		const expected = type === 'eq'
			? [
				'outputGain',
				...effect.params.bands.flatMap((band: { id: string }) => [
					'enabled', 'type', 'frequency', 'gain', 'q', 'slope',
				].map((parameterId) => `${band.id}:${parameterId}`)),
			]
			: Object.keys(definition.ranges);
		const actual = inventory.descriptors.map((descriptor) => {
			assert.equal(descriptor.address.kind, 'effect');
			if (descriptor.address.kind !== 'effect') return '';
			return descriptor.address.elementId
				? `${descriptor.address.elementId}:${descriptor.address.parameterId}`
				: descriptor.address.parameterId;
		});
		assert.deepEqual(actual, expected, type);
		assert.equal(inventory.revisionInputs.length, 0, type);
		for (const descriptor of inventory.descriptors.filter((candidate) => !candidate.automatable)) {
			assert.ok(descriptor.automationBlockReason, `${type} ${descriptor.id}`);
		}
		for (const descriptor of inventory.descriptors.filter((candidate) => candidate.taper === 'logarithmic')) {
			assert.ok(descriptor.minimum > 0, `${type} ${descriptor.id}`);
		}
	}

	for (const type of AUDACITY_RACK_EFFECT_TYPES) {
		const effect = createEffect(type, { id: `${type}-inventory` });
		const inventory = effectParameterInventory(TRACK, effect);
		const definition = AUDACITY_EFFECT_DEFINITIONS[type];
		const expected: string[] = [];
		const expectedRevisionInputs: string[] = [];
		const definitions = Object.entries(definition.params) as Array<[
			string,
			{ readonly kind?: unknown; readonly frequencies?: readonly unknown[] },
		]>;
		for (const [parameterId, descriptor] of definitions) {
			if (descriptor.kind === 'curve') expectedRevisionInputs.push(parameterId);
			else if (descriptor.kind === 'bands') {
				expected.push(...(descriptor.frequencies || []).map(
					(frequency) => `frequency:${String(frequency)}:${parameterId}`,
				));
			} else expected.push(parameterId);
		}
		const actual = inventory.descriptors.map((descriptor) => {
			assert.equal(descriptor.address.kind, 'effect');
			if (descriptor.address.kind !== 'effect') return '';
			return descriptor.address.elementId
				? `${descriptor.address.elementId}:${descriptor.address.parameterId}`
				: descriptor.address.parameterId;
		});
		assert.deepEqual(actual, expected, type);
		assert.deepEqual(
			inventory.revisionInputs.map((input) => input.parameterId),
			expectedRevisionInputs,
			type,
		);
		for (const descriptor of inventory.descriptors.filter((candidate) => !candidate.automatable)) {
			assert.ok(descriptor.automationBlockReason, `${type} ${descriptor.id}`);
		}
		for (const descriptor of inventory.descriptors.filter((candidate) => candidate.taper === 'logarithmic')) {
			assert.ok(descriptor.minimum > 0, `${type} ${descriptor.id}`);
		}
	}

	const limiter = effectParameterInventory(TRACK, createEffect('limiter', { id: 'limiter' }));
	const reverb = effectParameterInventory(TRACK, createEffect('reverb', { id: 'reverb' }));
	const graphic = effectParameterInventory(
		TRACK, createEffect('audacity-graphic-eq', { id: 'graphic' }),
	);
	const phaser = effectParameterInventory(
		TRACK, createEffect('audacity-phaser', { id: 'phaser' }),
	);
	const classic = effectParameterInventory(
		TRACK, createEffect('audacity-classic-filters', { id: 'classic' }),
	);
	const distortion = effectParameterInventory(
		TRACK, createEffect('audacity-distortion', { id: 'distortion' }),
	);
	assert.match(blockReason(limiter, 'lookahead'), /latency/iu);
	assert.match(blockReason(reverb, 'decay'), /graph/iu);
	assert.match(blockReason(graphic, 'filterLength'), /latency/iu);
	assert.match(blockReason(phaser, 'stages'), /topology/iu);
	assert.match(blockReason(classic, 'order'), /topology/iu);
	assert.match(blockReason(classic, 'family'), /topology/iu);
	assert.match(blockReason(classic, 'direction'), /topology/iu);
	assert.match(blockReason(distortion, 'dcBlock'), /(topology|tail)/iu);
	assert.match(blockReason(distortion, 'mode'), /topology/iu);
	assert.equal(AUDACITY_EFFECT_DEFINITIONS['audacity-phaser'].params.stages.automatable, false);
	assert.equal(AUDACITY_EFFECT_DEFINITIONS['audacity-classic-filters'].params.order.automatable, false);
	assert.equal(AUDACITY_EFFECT_DEFINITIONS['audacity-distortion'].params.dcBlock.automatable, false);
	assert.equal(AUDACITY_EFFECT_DEFINITIONS['audacity-distortion'].params.mode.automatable, false);

	for (const type of Object.keys(AUDIO_EFFECT_DEFINITIONS)) {
		const inventory = effectParameterInventory(TRACK, createEffect(type, { id: `${type}-taper` }));
		for (const descriptor of inventory.descriptors) {
			if (descriptor.taper === 'logarithmic') {
				assert.ok(descriptor.minimum > 0, `${type} ${descriptor.id}`);
			}
		}
	}
	assert.equal(parameterDescriptor(limiter, 'lookahead').taper, 'linear');
});

function blockReason(
	inventory: ReturnType<typeof effectParameterInventory>,
	parameterId: string,
): string {
	const descriptor = inventory.descriptors.find((candidate) => (
		candidate.address.kind === 'effect' && candidate.address.parameterId === parameterId
	));
	assert.equal(descriptor?.automatable, false);
	return descriptor?.automationBlockReason || '';
}

function parameterDescriptor(
	inventory: ReturnType<typeof effectParameterInventory>,
	parameterId: string,
) {
	const descriptor = inventory.descriptors.find((candidate) => (
		candidate.address.kind === 'effect' && candidate.address.parameterId === parameterId
	));
	assert.ok(descriptor);
	return descriptor;
}
