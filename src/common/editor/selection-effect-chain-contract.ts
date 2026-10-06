/* SPDX-License-Identifier: AGPL-3.0-only */
import { AUDACITY_EFFECT_DEFINITIONS } from './audacity-effects/manifest.js';
import { isAudacityEffectLiveCapable } from './audacity-effects/live-capability-policy.js';

export const SELECTION_EFFECT_CHAIN_STEP_LIMIT = 32;
export interface SelectionEffectChainStep {
	readonly effectType: string;
	readonly params: Readonly<Record<string, unknown>>;
}
interface Definition {
	readonly preRollSeconds?: number; readonly requiresContext?: boolean;
	readonly requiresControlTrack?: boolean; readonly requiresNoiseProfile?: boolean; readonly requiresStaffPad?: boolean;
}
const definitions = AUDACITY_EFFECT_DEFINITIONS as Readonly<Record<string, Definition | undefined>>;

/** A closed offline packet has no rack state, external context, reviewed authorization, or WASM-module input. */
export function isBatchableSelectionEffectStep(step: SelectionEffectChainStep): boolean {
	const definition = Object.hasOwn(definitions, step.effectType) ? definitions[step.effectType] : undefined;
	return Boolean(definition && !isAudacityEffectLiveCapable(step.effectType)
		&& !definition.preRollSeconds && !definition.requiresContext && !definition.requiresStaffPad
		&& !definition.requiresControlTrack && !definition.requiresNoiseProfile);
}
