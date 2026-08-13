/* SPDX-License-Identifier: AGPL-3.0-only */

import { effectParameterInventory } from '../effect-parameter-descriptors.ts';
import type { StripRef } from '../parameter-address.ts';
import type { EngineEffect } from './types.ts';
import type { ScheduledParameterRegistry } from './scheduled-parameter-registry.ts';

export type EffectParameterScope = 'track' | 'group' | 'send' | 'master';

export interface EffectParameterBindingOptions {
	readonly parameterRegistry?: ScheduledParameterRegistry;
	readonly scope?: string;
	readonly targetId?: unknown;
	readonly latencyFrames?: unknown;
}

export function registerEffectAudioParam(
	effect: EngineEffect,
	parameterId: string,
	param: AudioParam,
	options: EffectParameterBindingOptions,
	elementId?: string,
): void {
	const inventory = parameterInventory(effect, options);
	if (!inventory) return;
	const descriptor = inventory.descriptors.find((candidate) => (
		candidate.automatable
		&& candidate.address.kind === 'effect'
		&& candidate.address.parameterId === parameterId
		&& candidate.address.elementId === elementId
	));
	if (!descriptor) return;
	options.parameterRegistry?.registerAudioParam(descriptor, param, {
		latencyFrames: latencyFrames(options.latencyFrames),
	});
}

export function registerEffectAudioParamGroup(
	effect: EngineEffect,
	parameterId: string,
	bindings: readonly Readonly<{
		param: AudioParam;
		transformValue?: (value: number) => number;
	}>[],
	options: EffectParameterBindingOptions,
	elementId?: string,
): void {
	const inventory = parameterInventory(effect, options);
	if (!inventory) return;
	const descriptor = inventory.descriptors.find((candidate) => (
		candidate.automatable
		&& candidate.address.kind === 'effect'
		&& candidate.address.parameterId === parameterId
		&& candidate.address.elementId === elementId
	));
	if (!descriptor) return;
	options.parameterRegistry?.registerAudioParamGroup(descriptor, bindings, {
		latencyFrames: latencyFrames(options.latencyFrames),
	});
}

export function registerEffectMessageParameters(
	effect: EngineEffect,
	port: MessagePort | null | undefined,
	options: EffectParameterBindingOptions,
): void {
	if (!port?.postMessage) return;
	const inventory = parameterInventory(effect, options);
	if (!inventory) return;
	for (const descriptor of inventory.descriptors) {
		if (!descriptor.automatable) continue;
		options.parameterRegistry?.registerMessageTarget(
			descriptor,
			(message) => { port.postMessage(message); },
			{ latencyFrames: latencyFrames(options.latencyFrames) },
		);
	}
}

function parameterInventory(
	effect: EngineEffect,
	options: EffectParameterBindingOptions,
): ReturnType<typeof effectParameterInventory> | null {
	if (!options.parameterRegistry || typeof effect?.id !== 'string' || !effect.id) return null;
	const strip = effectStripRef(options.scope, options.targetId);
	if (!strip) return null;
	return effectParameterInventory(strip, effect);
}

function effectStripRef(scope: unknown, targetId: unknown): StripRef | null {
	if (scope === 'master') return { kind: 'master' };
	if (scope === 'track' && targetId != null && String(targetId)) {
		return { kind: 'track', id: String(targetId) };
	}
	if ((scope === 'group' || scope === 'send') && targetId != null && String(targetId)) {
		return { kind: 'mixer-node', id: String(targetId) };
	}
	return null;
}

function latencyFrames(value: unknown): number {
	const number = Number(value);
	return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}
