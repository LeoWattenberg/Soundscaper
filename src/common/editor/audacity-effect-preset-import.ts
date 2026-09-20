/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDACITY_EFFECT_MACRO_COMMANDS,
	parseAudacityEffectMacro,
} from './effect-macros.js';

interface ParsedMacroEffect {
	readonly type: string;
	readonly params: Readonly<Record<string, unknown>>;
}

interface ParsedMacro {
	readonly effects: readonly ParsedMacroEffect[];
	readonly ignoredCommands: readonly string[];
}

export interface AudacityEffectPresetImport {
	readonly effectType: string;
	readonly params: Readonly<Record<string, unknown>>;
}

/**
 * Parse the one-line text file written by Audacity's Export effect parameters
 * action. Audacity uses the same `Command:Name="value"` representation for an
 * exported preset and for one effect step in a macro, so the audited macro
 * parser remains the single owner of command IDs, parameter aliases, numeric
 * conversions and equalization curves.
 */
export function parseAudacityEffectPreset(
	text: string,
	expectedEffectType: string | null = null,
): AudacityEffectPresetImport {
	if (typeof text !== 'string') throw new TypeError('An Audacity effect preset must be text.');
	const source = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trim();
	if (!source) throw new RangeError('The Audacity effect preset is empty.');
	if (/\r|\n/u.test(source)) throw new SyntaxError('An Audacity effect preset must contain exactly one effect line.');

	const parsed = parseAudacityEffectMacro(source, {
		idFactory: () => 'audacity-preset-import',
	}) as ParsedMacro;
	if (parsed.effects.length !== 1 || parsed.ignoredCommands.length) {
		throw new SyntaxError('An Audacity effect preset must contain exactly one supported effect.');
	}
	const effect = parsed.effects[0];
	if (!effect || !Object.hasOwn(AUDACITY_EFFECT_MACRO_COMMANDS, effect.type)) {
		throw new RangeError('The Audacity preset does not describe a ported effect.');
	}
	if (expectedEffectType && effect.type !== expectedEffectType) {
		throw new RangeError(`The Audacity preset is for a different effect (${effect.type}).`);
	}
	return Object.freeze({ effectType: effect.type, params: effect.params });
}
