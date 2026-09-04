/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDIO_RACK_EFFECT_DEFINITIONS,
	AUDIO_SELECTION_EFFECT_DEFINITIONS,
	audioSelectionEffectDefaults,
	createEffect,
	normalizeAudioSelectionEffectParams,
} from './effects.js';
import { createStableId } from './project.js';

type EffectParams = Readonly<Record<string, unknown>>;
// The effect registry is untyped JavaScript whose optional effect-ID argument
// infers as `null`; both helpers accept the step's ID.
const selectionEffectDefaults = audioSelectionEffectDefaults as unknown as (
	type: string,
	effectId: string,
) => EffectParams;
const normalizeSelectionEffectParams = normalizeAudioSelectionEffectParams as unknown as (
	type: string,
	params: EffectParams,
	effectId: string,
) => EffectParams;

export interface EffectMacroStep extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: string;
	readonly enabled: boolean;
	readonly params: Readonly<Record<string, unknown>>;
	readonly context?: Readonly<Record<string, unknown>>;
}

export interface EffectMacroStepOptions {
	readonly id?: unknown;
	readonly enabled?: unknown;
	readonly params?: unknown;
	readonly context?: unknown;
}

function macroStepDefinitions(): Readonly<Record<string, unknown>> {
	const definitions: Record<string, unknown> = { ...AUDIO_RACK_EFFECT_DEFINITIONS };
	for (const [type, definition] of Object.entries(AUDIO_SELECTION_EFFECT_DEFINITIONS)) {
		if (!Object.hasOwn(definitions, type)) definitions[type] = definition;
	}
	return Object.freeze(definitions);
}

/**
 * Every effect a macro step may hold.
 *
 * Audacity's Macro Manager inserts any effect, not only the ones a realtime
 * rack can stream, so a macro step is the union of the two registries. The rack
 * definitions keep their order and their live parameter ranges so an existing
 * macro reads unchanged, and the effects that only run over a selection —
 * Amplify, Normalize, Change Pitch, Truncate Silence and the rest — follow in
 * the order the effect menu lists them.
 */
export const EFFECT_MACRO_STEP_DEFINITIONS = macroStepDefinitions();

export function effectMacroStepTypes(): readonly string[] {
	return Object.keys(EFFECT_MACRO_STEP_DEFINITIONS);
}

export function isEffectMacroStepType(type: unknown): type is string {
	return typeof type === 'string' && Object.hasOwn(EFFECT_MACRO_STEP_DEFINITIONS, type);
}

/**
 * Whether a step streams through an effect rack. The rest are applied offline,
 * one selection at a time, exactly as the effect menu applies them.
 */
export function isRealtimeEffectMacroStepType(type: unknown): type is string {
	return typeof type === 'string' && Object.hasOwn(AUDIO_RACK_EFFECT_DEFINITIONS, type);
}

/**
 * Build one macro step. Rack effects keep the rack's own factory, so their
 * live parameter ranges, routing context and processor state stay authoritative;
 * an offline effect is a settings-only step with no rack metadata to carry.
 */
export function createEffectMacroStep(
	type: unknown,
	options: EffectMacroStepOptions = {},
): EffectMacroStep {
	if (isRealtimeEffectMacroStepType(type)) return createEffect(type, options) as EffectMacroStep;
	if (!isEffectMacroStepType(type)) throw new RangeError(`Unsupported macro effect: ${String(type)}.`);
	const id = (options.id as string | undefined) || createStableId('effect');
	if (typeof id !== 'string' || !id) throw new TypeError('Every effect needs a stable ID.');
	if (options.context !== undefined) {
		throw new RangeError(`A ${type} macro step carries no rack context.`);
	}
	const params = normalizeSelectionEffectParams(type, {
		...selectionEffectDefaults(type, id),
		...(options.params as EffectParams | undefined ?? {}),
	}, id);
	return { id, type, enabled: options.enabled !== false, params };
}

/** Re-validate a stored macro step against the current definitions. */
export function normalizeEffectMacroStep(effect: unknown): EffectMacroStep {
	if (!effect || typeof effect !== 'object') throw new TypeError('An effect is required.');
	const candidate = effect as EffectMacroStepOptions & { readonly type?: unknown };
	return createEffectMacroStep(candidate.type, candidate);
}
