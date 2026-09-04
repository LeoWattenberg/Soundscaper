/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * A macro step that runs a command rather than an effect.
 *
 * Audacity's macro file is a command script, and only one of its three tiers is
 * effects. This is the model for the others: a step naming a command and the
 * parameters it was actually given.
 *
 * It deliberately does not go through `createEffectMacroStep`. That factory's
 * whole job is to fill in every parameter an effect defines, and a command
 * parameter means the opposite — absent is "leave this alone", not "use the
 * default", so a default-filled command step would turn every import into a full
 * rewrite of whatever it touches.
 */

import {
	audacitySelectCommandProfile,
	decodeMacroCommandParameter,
	type MacroCommandParameterDescriptor,
	type MacroCommandProfile,
} from './audacity-macro-select-commands.ts';
import { stableNumberString } from './audacity-command-parameters.js';
import { createStableId } from './project.js';

export interface MacroCommandStep extends Readonly<Record<string, unknown>> {
	readonly kind: 'command';
	readonly id: string;
	readonly enabled: boolean;
	readonly command: string;
	readonly params: Readonly<Record<string, unknown>>;
}

export interface MacroCommandStepOptions {
	readonly id?: unknown;
	readonly enabled?: unknown;
	readonly params?: unknown;
	readonly context?: unknown;
}

/** Every command a macro step may name. */
export function macroCommandStepCommands(): readonly string[] {
	return Object.keys(macroCommandProfiles());
}

export function macroCommandStepProfile(command: unknown): MacroCommandProfile | null {
	return audacitySelectCommandProfile(command);
}

export function isMacroCommandStep(value: unknown): value is MacroCommandStep {
	return Boolean(value) && typeof value === 'object'
		&& (value as { kind?: unknown }).kind === 'command';
}

export function createMacroCommandStep(
	command: unknown,
	options: MacroCommandStepOptions = {},
): MacroCommandStep {
	const profile = macroCommandStepProfile(command);
	if (!profile) throw new RangeError(`Unsupported macro command: ${String(command)}.`);
	const id = (options.id as string | undefined) || createStableId('step');
	if (typeof id !== 'string' || !id || id.length > 1_024) {
		throw new TypeError('Every macro step needs a bounded stable string ID.');
	}
	if (options.context !== undefined) {
		throw new RangeError(`A ${String(command)} macro step carries no context.`);
	}
	return Object.freeze({
		kind: 'command' as const,
		id,
		enabled: options.enabled !== false,
		command: command as string,
		params: readParams(command as string, profile, options.params),
	});
}

/** Re-validate a stored command step against the current vocabulary. */
export function normalizeMacroCommandStep(value: unknown): MacroCommandStep {
	if (!value || typeof value !== 'object') throw new TypeError('A macro command step is required.');
	const candidate = value as MacroCommandStepOptions & { readonly command?: unknown };
	return createMacroCommandStep(candidate.command, candidate);
}

/**
 * The step's parameters as Audacity CommandParameters entries, in the order
 * Audacity declares them and carrying only what the step was given.
 */
export function encodeMacroCommandStepParameters(
	step: MacroCommandStep,
): readonly (readonly [string, string])[] {
	const profile = macroCommandStepProfile(step.command);
	if (!profile) throw new RangeError(`Unsupported macro command: ${step.command}.`);
	const entries: (readonly [string, string])[] = [];
	for (const descriptor of profile.params) {
		if (!Object.hasOwn(step.params, descriptor.model)) continue;
		entries.push([descriptor.native, encodeParameter(descriptor, step.params[descriptor.model])]);
	}
	return Object.freeze(entries);
}

function encodeParameter(descriptor: MacroCommandParameterDescriptor, value: unknown): string {
	return descriptor.encode ? descriptor.encode(value) : stableNumberString(value);
}

function macroCommandProfiles(): Readonly<Record<string, MacroCommandProfile>> {
	// One accessor so the vocabulary has a single place to grow when the bare
	// menu-command tier joins the parameterised one.
	return SELECT_PROFILES;
}

function readParams(
	command: string,
	profile: MacroCommandProfile,
	value: unknown,
): Readonly<Record<string, unknown>> {
	if (value === undefined || value === null) return Object.freeze({});
	if (typeof value !== 'object') throw new TypeError(`${command} parameters must be an object.`);
	const descriptors = new Map(profile.params.map((descriptor) => [descriptor.model, descriptor]));
	const params: Record<string, unknown> = {};
	for (const [name, supplied] of Object.entries(value as Record<string, unknown>)) {
		if (supplied === undefined) continue;
		const descriptor = descriptors.get(name);
		if (!descriptor) throw new RangeError(`Unsupported ${command} parameter: ${name}.`);
		params[name] = decodeMacroCommandParameter(descriptor, supplied);
	}
	return Object.freeze(params);
}

const SELECT_PROFILES: Readonly<Record<string, MacroCommandProfile>> = Object.freeze({
	Select: audacitySelectCommandProfile('Select')!,
	SelectTime: audacitySelectCommandProfile('SelectTime')!,
	SelectFrequencies: audacitySelectCommandProfile('SelectFrequencies')!,
	SelectTracks: audacitySelectCommandProfile('SelectTracks')!,
});
