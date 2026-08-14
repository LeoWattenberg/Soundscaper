/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScheduledParameterRegistry } from './scheduled-parameter-registry.ts';
import type { EngineRuntimeMethodMap } from './runtime-types.ts';
import { ENGINE_ASSERT_ACTIVE } from './runtime-symbols.ts';

export interface AutomationControlPreviewInputV21 {
	readonly graph: Readonly<{ readonly parameterRegistry: ScheduledParameterRegistry }> | null;
	readonly context: Readonly<{ readonly currentTime: number; readonly sampleRate: number }> | null;
	readonly address: unknown;
	readonly value: number;
	readonly projectFrame: number;
	readonly projectSampleRate: number;
	readonly transportRate: number;
}

/**
 * Preview one controller-owned native value through the same registered target
 * and path-latency offset used by lane playback. No graph means no audition.
 */
export function scheduleAutomationControlPreviewV21(
	input: AutomationControlPreviewInputV21,
): boolean {
	if (!input.graph || !input.context) return false;
	const target = input.graph.parameterRegistry.get(input.address);
	if (!target) return false;
	const frame = nonNegativeSafeInteger(input.projectFrame, 'automation preview frame');
	target.schedule(Object.freeze([Object.freeze({
		kind: 'set' as const,
		frame,
		value: finiteNumber(input.value, 'automation preview value'),
	})]), Object.freeze({
		fromFrame: frame,
		contextStartTime: nonNegativeFiniteNumber(input.context.currentTime, 'audio context time'),
		sampleRate: positiveSafeInteger(input.projectSampleRate, 'project sample rate'),
		contextSampleRate: positiveSafeInteger(input.context.sampleRate, 'audio context sample rate'),
		transportRate: positiveFiniteNumber(input.transportRate, 'transport rate'),
	}));
	return true;
}

export const engineAutomationControlMethods = {
	previewScheduledParameter(address, value) {
		this[ENGINE_ASSERT_ACTIVE]();
		return scheduleAutomationControlPreviewV21({
			graph: this.graph,
			context: this.context,
			address,
			value,
			projectFrame: this.positionFrame,
			projectSampleRate: this.sampleRate,
			transportRate: this.playbackRate,
		});
	},
} satisfies EngineRuntimeMethodMap<'previewScheduledParameter'>;

function finiteNumber(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) {
		throw new RangeError(`${name} must be a finite canonical number.`);
	}
	return value;
}

function nonNegativeFiniteNumber(value: unknown, name: string): number {
	const number = finiteNumber(value, name);
	if (number < 0) throw new RangeError(`${name} must be non-negative.`);
	return number;
}

function positiveFiniteNumber(value: unknown, name: string): number {
	const number = finiteNumber(value, name);
	if (number <= 0) throw new RangeError(`${name} must be positive.`);
	return number;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}
