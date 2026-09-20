/* SPDX-License-Identifier: AGPL-3.0-only */

import { effectMacroMissingEmbeddedNoiseProfile } from '../effect-macro-readiness.ts';

export const EFFECT_MACRO_APPLICATION_MENU_ID = 'macro-library';

export interface EffectMacroApplicationMenuEntry {
	readonly id: string;
	readonly name: string;
	readonly effects: readonly Readonly<{
		readonly type?: unknown;
		readonly enabled?: unknown;
		readonly context?: Readonly<Record<string, unknown>>;
	}>[];
}

export interface EffectMacroApplicationMenuItem {
	readonly id: string;
	readonly label: string;
	readonly disabled: boolean;
	readonly onClick: () => unknown;
}

export interface EffectMacroApplicationMenu {
	readonly id: typeof EFFECT_MACRO_APPLICATION_MENU_ID;
	readonly label: string;
	readonly disabled: boolean;
	readonly items: readonly EffectMacroApplicationMenuItem[];
}

/** Build Tools > Macros from the same saved library shown by Macro Manager. */
export function createEffectMacroApplicationMenu(
	macros: readonly EffectMacroApplicationMenuEntry[],
	options: Readonly<{ label: string; editBlocked: boolean }>,
	actions: Readonly<{ run: (macro: EffectMacroApplicationMenuEntry) => unknown }>,
): EffectMacroApplicationMenu {
	return Object.freeze({
		id: EFFECT_MACRO_APPLICATION_MENU_ID,
		label: options.label,
		disabled: macros.length === 0,
		items: Object.freeze(macros.map((macro) => Object.freeze({
			id: `${EFFECT_MACRO_APPLICATION_MENU_ID}:${encodeURIComponent(macro.id)}`,
			label: macro.name,
			disabled: options.editBlocked
				|| macro.effects.length === 0
				|| effectMacroMissingEmbeddedNoiseProfile(macro.effects),
			onClick: () => actions.run(macro),
		}))),
	});
}
