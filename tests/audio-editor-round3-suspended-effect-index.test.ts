/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { effectParameterInventory } from '../src/common/editor/effect-parameter-descriptors.ts';
import { createSuspendedEffectParameterRegistrarV21, indexSuspendedEffectLanesV21, registerSuspendedEffectParametersV21 } from '../src/common/editor/engine/project-suspended-effect-parameters-v21.ts';
import { ScheduledParameterRegistry } from '../src/common/editor/engine/scheduled-parameter-registry.ts';

test('suspended effect targets inspect each lane once and preserve exact descriptor registration', () => {
	const strip = { kind: 'track' as const, id: 'one' };
	const effects = Array.from({ length: 20 }, (_, index) => ({
		id: `effect-${String(index)}`, type: 'compressor', params: { threshold: -18, ratio: 4 },
	}));
	const inventories = effects.map(effect => effectParameterInventory(strip, effect, { sampleRate: 48_000 }));
	const descriptors = inventories.map(inventory => {
		const descriptor = inventory.descriptors.find(value => value.automatable);
		assert.ok(descriptor);
		return descriptor;
	});
	let reads = 0;
	const lanes = Array.from({ length: 500 }, (_, index) => {
		const descriptor = descriptors[index % descriptors.length]!;
		const lane = normalizeAutomationLaneV21({
			id: `lane-${String(index)}`, address: descriptor.address, timebase: 'absolute-samples',
			points: [{ id: 'point', position: 0, value: descriptor.defaultValue }], segments: [],
		});
		return { ...lane, get address() { reads += 1; return lane.address; } };
	});
	const indexed = indexSuspendedEffectLanesV21(lanes);
	assert.equal(reads, 500);
	const registry = new ScheduledParameterRegistry();
	registerSuspendedEffectParametersV21(registry, strip, effects, indexed, 48_000);
	assert.equal(reads, 500);
	for (const descriptor of descriptors) {
		assert.deepEqual(registry.getSuspendedParameter(descriptor.address), descriptor);
	}
	assert.equal(registry.size, 0);
	const other = new ScheduledParameterRegistry();
	registerSuspendedEffectParametersV21(other, { kind: 'track', id: 'other' }, effects, indexed, 48_000);
	assert.equal(other.getSuspendedParameter(descriptors[0]!.address), null);
	reads = 0;
	const lazy = new ScheduledParameterRegistry();
	const register = createSuspendedEffectParameterRegistrarV21(lazy, lanes, 48_000);
	register(strip, []);
	assert.equal(reads, 0, 'active racks do not prepare an unused suspended-lane index');
	register(strip, effects);
	assert.equal(reads, 500);
	register({ kind: 'track', id: 'other' }, effects);
	assert.equal(reads, 500, 'subsequent suspended racks reuse the prepared index');
	for (const descriptor of descriptors) assert.deepEqual(lazy.getSuspendedParameter(descriptor.address), descriptor);
});
