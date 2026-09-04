/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Audacity's selection scripting commands: the four macro commands that move
 * the selection rather than change audio. Command names, parameter names,
 * ranges, enumerations and the asymmetric `RelativeTo` arithmetic are ported
 * from Audacity 3.7.7 commit 5ef610ed23260d6d648175735bb16b32536eb30b,
 * src/commands/SelectCommand.cpp. Audacity is distributed under GPL version 3;
 * this TypeScript adaptation was created for kw.media in 2026.
 */

import {
	booleanValue,
	enumParam,
	finiteNumber,
	numberParam,
} from './audacity-command-parameters.js';

/**
 * An enumerated parameter, carrying both spellings.
 *
 * A step is built from Soundscaper's own value and parsed from Audacity's, so
 * the descriptor has to admit either: the model list validates what an author
 * or the UI supplies, and the shared codec's decode reads what a macro file
 * carries.
 */
const enumeration = (
	model: string,
	native: string,
	values: readonly string[],
	nativeValues: readonly string[],
): MacroCommandParameterDescriptor => ({
	...(enumParam(model, native, values, nativeValues) as Omit<MacroCommandParameterDescriptor, 'kind'>),
	kind: 'enum',
	values,
});

const FLOAT_MAX = 3.4028234663852886e38;

/**
 * Where a time is measured from.
 *
 * The arithmetic is deliberately not symmetric, and Audacity's own switch is the
 * specification: `Project` extends the end past the project's, `ProjectEnd`
 * counts backwards from it, and `Selection` moves each edge by its own offset.
 */
export const AUDACITY_SELECT_RELATIVE_TO = Object.freeze([
	'project-start', 'project', 'project-end',
	'selection-start', 'selection', 'selection-end',
] as const);

const NATIVE_RELATIVE_TO = Object.freeze([
	'ProjectStart', 'Project', 'ProjectEnd',
	'SelectionStart', 'Selection', 'SelectionEnd',
]);

export const AUDACITY_SELECT_TRACK_MODES = Object.freeze(['set', 'add', 'remove'] as const);
const NATIVE_TRACK_MODES = Object.freeze(['Set', 'Add', 'Remove']);

export type AudacitySelectRelativeTo = typeof AUDACITY_SELECT_RELATIVE_TO[number];
export type AudacitySelectTrackMode = typeof AUDACITY_SELECT_TRACK_MODES[number];

export interface MacroCommandParameterDescriptor {
	readonly model: string;
	readonly native: string;
	readonly kind: 'number' | 'boolean' | 'enum';
	readonly minimum?: number;
	readonly maximum?: number;
	/** The model spellings an enumerated parameter accepts. */
	readonly values?: readonly string[];
	readonly encode?: (value: unknown) => string;
	readonly decode?: (value: unknown) => unknown;
}

export interface MacroCommandProfile {
	readonly params: readonly MacroCommandParameterDescriptor[];
}

// The shared codec is untyped JavaScript, so each factory's `kind` arrives as a
// bare string; naming it here narrows it without restating the descriptor.
const bounded = (
	model: string,
	native: string,
	minimum: number,
	maximum: number,
): MacroCommandParameterDescriptor => ({
	...(numberParam(model, native) as Omit<MacroCommandParameterDescriptor, 'kind'>),
	kind: 'number',
	minimum,
	maximum,
});

// Audacity allows a selection to reach a hundred seconds before zero, so a macro
// can contract or expand one by a small amount without clamping at the start.
const TIME_PARAMS: readonly MacroCommandParameterDescriptor[] = Object.freeze([
	bounded('start', 'Start', -100, FLOAT_MAX),
	bounded('end', 'End', -100, FLOAT_MAX),
	enumeration('relativeTo', 'RelativeTo', AUDACITY_SELECT_RELATIVE_TO, NATIVE_RELATIVE_TO),
]);

const FREQUENCY_PARAMS: readonly MacroCommandParameterDescriptor[] = Object.freeze([
	bounded('high', 'High', 0, FLOAT_MAX),
	bounded('low', 'Low', 0, FLOAT_MAX),
]);

// Track and TrackCount are doubles upstream because a channel once counted as a
// fraction of a track; the values are still ordinary indices and counts here.
const TRACK_PARAMS: readonly MacroCommandParameterDescriptor[] = Object.freeze([
	bounded('track', 'Track', 0, 100),
	bounded('trackCount', 'TrackCount', 0, 100),
	enumeration('mode', 'Mode', AUDACITY_SELECT_TRACK_MODES, NATIVE_TRACK_MODES),
]);

/**
 * The commands, in Audacity's own declaration order.
 *
 * Every parameter is optional in Audacity's sense: absent means "leave this
 * alone", not "use the default". `SelectTime` given neither `Start` nor `End`
 * returns without touching the selection at all, so a step keeps only the
 * parameters it was actually given.
 */
export const AUDACITY_SELECT_COMMAND_PROFILES: Readonly<Record<string, MacroCommandProfile>> =
	Object.freeze({
		Select: Object.freeze({
			params: Object.freeze([...TIME_PARAMS, ...FREQUENCY_PARAMS, ...TRACK_PARAMS]),
		}),
		SelectTime: Object.freeze({ params: TIME_PARAMS }),
		SelectFrequencies: Object.freeze({ params: FREQUENCY_PARAMS }),
		SelectTracks: Object.freeze({ params: TRACK_PARAMS }),
	});

export function audacitySelectCommandProfile(command: unknown): MacroCommandProfile | null {
	return typeof command === 'string' && Object.hasOwn(AUDACITY_SELECT_COMMAND_PROFILES, command)
		? AUDACITY_SELECT_COMMAND_PROFILES[command]!
		: null;
}

/** Read one supplied parameter, refusing anything the upstream range refuses. */
export function decodeMacroCommandParameter(
	descriptor: MacroCommandParameterDescriptor,
	value: unknown,
): unknown {
	if (descriptor.kind === 'enum') {
		// Soundscaper's own spelling passes straight through; Audacity's is read
		// by the shared codec, which also still accepts the bare indexes older
		// releases wrote.
		if (typeof value === 'string' && descriptor.values?.includes(value)) return value;
		const decoded = descriptor.decode?.(value);
		if (decoded === undefined) {
			throw new RangeError(`Unsupported ${descriptor.native} value: ${String(value)}.`);
		}
		return decoded;
	}
	if (descriptor.kind === 'boolean') {
		const decoded = booleanValue(value);
		if (decoded === undefined) {
			throw new RangeError(`Unsupported ${descriptor.native} value: ${String(value)}.`);
		}
		return decoded;
	}
	const decoded = finiteNumber(value);
	if (decoded === undefined) {
		throw new RangeError(`${descriptor.native} must be a finite number.`);
	}
	const minimum = descriptor.minimum ?? Number.NEGATIVE_INFINITY;
	const maximum = descriptor.maximum ?? Number.POSITIVE_INFINITY;
	if (decoded < minimum || decoded > maximum) {
		throw new RangeError(`${descriptor.native} must be between ${minimum} and ${maximum}.`);
	}
	return decoded;
}
