/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateCurrentV1 } from './image-develop-state-current-v1.ts';
import type { ImageDevelopMaskPlanV1, ImageDevelopMaskBindingPlanV1 } from './image-develop-mask-plan-v1.ts';
import type { LinearKernelDescriptorV1 } from './linear-kernel-descriptor-v1.ts';

type Effect = ImageDevelopStateCurrentV1['effects'][number];
export type LinearDevelopAuthoredSlotIdentityCurrentV1 = Readonly<{ origin: 'legacy-geometry' }>
	| Readonly<{ origin: 'effect'; effectIndex: number; effectId: string; effectType: string; enabled: boolean }>;
export interface LinearDevelopAuthoredSlotCurrentV1 {
	readonly ordinal: number;
	readonly identity: LinearDevelopAuthoredSlotIdentityCurrentV1;
	readonly incoming: LinearKernelDescriptorV1;
	readonly output: LinearKernelDescriptorV1;
	/** Index in scalar metadata.stages, including noops; null only when no stage was emitted. */
	readonly stageIndex: number | null;
	/** Exact Current planner object: copying it loses ordered-suffix projection authority. */
	readonly binding: Readonly<ImageDevelopMaskBindingPlanV1> | undefined;
}
export interface LinearDevelopAuthoredSlotsCurrentV1 {
	readonly slots: readonly Readonly<LinearDevelopAuthoredSlotCurrentV1>[];
	readonly maskPlan: Readonly<ImageDevelopMaskPlanV1>;
}

/** Internal scalar recorder for the already-normalized Current traversal. It
 * admits neither recipes nor pixels and does not grant executable authority.
 * Only the metadata owner's private enrollment authenticates a completed owner. */
export function captureLinearDevelopAuthoredSlotsCurrentV1(maskPlan: Readonly<ImageDevelopMaskPlanV1>) {
	const bindings = new Map(maskPlan.bindings.map(binding => [binding.effectId, binding]));
	const slots: Readonly<LinearDevelopAuthoredSlotCurrentV1>[] = [], seen = new Set<string>();
	let effectIndex = 0, stageIndex = 0, finished = false;
	const open = () => { if (finished) throw new TypeError('Authored-slot capture has already finished.'); };
	const emitted = (index: number | null) => {
		if (index === null) return;
		if (index !== stageIndex) throw new RangeError('Authored slots require consecutive scalar metadata stage indices.');
		stageIndex++;
	};
	return Object.freeze({
		legacy(incoming: LinearKernelDescriptorV1, output: LinearKernelDescriptorV1, index: number): void {
			open();
			if (slots.length !== 0 || effectIndex !== 0) throw new RangeError('Legacy geometry is a single prefix.');
			emitted(index);
			slots.push(Object.freeze({ ordinal: 0, identity: Object.freeze({ origin: 'legacy-geometry' as const }),
				incoming, output, stageIndex: index, binding: undefined }));
		},
		effect(effect: Effect, index: number, incoming: LinearKernelDescriptorV1,
			output: LinearKernelDescriptorV1, metadataIndex: number | null): void {
			open();
			if (index !== effectIndex || index >= 256 || seen.has(effect.id)) throw new RangeError('Authored slots require ordered unique admitted effects.');
			if (metadataIndex === null && (effect.type !== 'develop-geometry-v1' || effect.enabled)) {
				throw new RangeError('Only disabled authored geometry omits its scalar metadata stage.');
			}
			if (metadataIndex === null && output !== incoming) throw new RangeError('A missing executable stage cannot change extent.');
			const binding = bindings.get(effect.id);
			if (binding && (binding.width !== incoming.width || binding.height !== incoming.height)) {
				throw new RangeError('Authored mask binding must retain its actual incoming extent.');
			}
			emitted(metadataIndex); effectIndex++; seen.add(effect.id);
			slots.push(Object.freeze({ ordinal: slots.length,
				identity: Object.freeze({ origin: 'effect' as const, effectIndex: index,
					effectId: effect.id, effectType: effect.type, enabled: effect.enabled }),
				incoming, output, stageIndex: metadataIndex, binding }));
		},
		finish(): Readonly<LinearDevelopAuthoredSlotsCurrentV1> {
			open();
			if (maskPlan.bindings.some(binding => !seen.has(binding.effectId))) throw new RangeError('Every retained mask binding requires its authored slot.');
			finished = true;
			return Object.freeze({ slots: Object.freeze(slots), maskPlan });
		},
	});
}
