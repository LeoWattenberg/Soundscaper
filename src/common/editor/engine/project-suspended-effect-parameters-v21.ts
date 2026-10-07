/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AutomationLaneV21 } from '../automation-lane-v21.ts';
import { effectParameterInventory } from '../effect-parameter-descriptors.ts';
import { mixerEndpointKeyV21 } from '../mixer-graph-v21.ts';
import { canonicalParameterAddressKey, type StripRef } from '../parameter-address.ts';
import type { ScheduledParameterRegistry } from './scheduled-parameter-registry.ts';
import type { EngineEffect } from './types.ts';

type SuspendedEffectLaneIndexV21 = ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>;

/** Active racks never prepare this graph-local index; the first suspended rack owns it. */
export function createSuspendedEffectParameterRegistrarV21(
	registry: ScheduledParameterRegistry,
	lanes: readonly AutomationLaneV21[],
	sampleRate: number,
): (strip: StripRef, effects: readonly EngineEffect[]) => void {
	let indexed: SuspendedEffectLaneIndexV21 | undefined;
	return (strip, effects): void => {
		if (effects.length === 0) return;
		indexed ??= indexSuspendedEffectLanesV21(lanes);
		registerSuspendedEffectParametersV21(registry, strip, effects, indexed, sampleRate);
	};
}

export function indexSuspendedEffectLanesV21(lanes: readonly AutomationLaneV21[]): SuspendedEffectLaneIndexV21 {
	const strips = new Map<string, Map<string, Set<string>>>();
	for (const lane of lanes) {
		const address = lane.address;
		if (address.kind !== 'effect') continue;
		const key = mixerEndpointKeyV21(address.strip);
		let effects = strips.get(key);
		if (!effects) { effects = new Map(); strips.set(key, effects); }
		let keys = effects.get(address.effectId);
		if (!keys) { keys = new Set(); effects.set(address.effectId, keys); }
		keys.add(canonicalParameterAddressKey(address));
	}
	return strips;
}

export function registerSuspendedEffectParametersV21(
	registry: ScheduledParameterRegistry,
	strip: StripRef,
	effects: readonly EngineEffect[],
	lanes: SuspendedEffectLaneIndexV21,
	sampleRate: number,
): void {
	const byEffect = lanes.get(mixerEndpointKeyV21(strip));
	if (!byEffect) return;
	for (const effect of effects) {
		const keys = effect.id === undefined ? undefined : byEffect.get(effect.id);
		if (!keys?.size) continue;
		for (const descriptor of effectParameterInventory(strip, effect, { sampleRate }).descriptors) {
			if (descriptor.automatable && keys.has(descriptor.id)) registry.registerSuspendedParameter(descriptor);
		}
	}
}
