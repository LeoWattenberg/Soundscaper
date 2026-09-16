/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEffectMacroLibrary } from '../../../../effect-macro-library.js';
import {
	EFFECT_MACRO_TEMPLATE_IDS,
	createEffectMacroTemplateDraft,
} from '../../../../effect-macro-templates.ts';
import type { EffectMacroDefaultsHydrationRuntime } from '../../effect-macro-defaults-service.ts';
import type { EffectMacroLibraryState } from '../../effect-macro-library-service.ts';

/** Former templates become independent ordinary macros once per library. */
export function createDefaultEffectMacroLibrary(value?: unknown): EffectMacroLibraryState {
	const current = createLibrary(value);
	if (current.defaultsInitialized) return current;
	const available = Math.max(0, 256 - current.macros.length);
	const defaults = EFFECT_MACRO_TEMPLATE_IDS.slice(0, available)
		.map((templateId) => createEffectMacroTemplateDraft(templateId));
	return createLibrary({
		...current,
		macros: [...current.macros, ...defaults],
		defaultsInitialized: true,
	});
}

/** Publish migration before its required write without losing state on failure. */
export async function hydrateDefaultEffectMacroLibrary(
	value: unknown,
	runtime: EffectMacroDefaultsHydrationRuntime,
	settingKey: string,
): Promise<void> {
	const current = createLibrary(value);
	const next = await runtime.guard(createDefaultEffectMacroLibrary(current));
	runtime.setEffectMacros(next);
	if (!current.defaultsInitialized) {
		try {
			await runtime.guard(runtime.persistEffectMacroLibrary?.(settingKey, next));
		} catch (error) {
			if (runtime.isDisposedError(error)) throw error;
			// A later edit or bootstrap can retry persistence. The session keeps both
			// the user's macros and the defaults even when their migration write fails.
			runtime.handleError(error);
		}
	}
}

function createLibrary(value?: unknown): EffectMacroLibraryState {
	return (createEffectMacroLibrary as (stored?: unknown) => unknown)(value) as EffectMacroLibraryState;
}
