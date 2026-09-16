/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	EFFECT_MACRO_LIBRARY_SETTING_KEY,
	createInitialEffectMacroLibrary,
	type EffectMacroLibraryState,
} from './effect-macro-library-service.ts';

export interface EffectMacroDefaultsHydrationRuntime {
	readonly guard: <Value>(value: PromiseLike<Value> | Value) => Promise<Value>;
	readonly setEffectMacros: (value: EffectMacroLibraryState) => void;
	readonly persistEffectMacroLibrary?: (key: string, value: EffectMacroLibraryState) => Promise<unknown>;
	readonly handleError: (error: unknown) => void;
	readonly isDisposedError: (error: unknown) => boolean;
}

/** Adopt the former templates as ordinary saved macros, once per Soundscaper library. */
export async function createDefaultEffectMacroLibrary(value?: unknown): Promise<EffectMacroLibraryState> {
	const current = createInitialEffectMacroLibrary(value);
	if (current.defaultsInitialized) return current;
	const defaults = await import('./internal/macro/effect-macro-defaults.ts');
	return defaults.createDefaultEffectMacroLibrary(current);
}

/** Keep Soundscaper's library migration outside the shared startup graph. */
export async function hydrateDefaultEffectMacroLibrary(
	value: unknown,
	runtime: EffectMacroDefaultsHydrationRuntime,
): Promise<void> {
	const current = createInitialEffectMacroLibrary(value);
	if (current.defaultsInitialized) {
		runtime.setEffectMacros(await runtime.guard(current));
		return;
	}
	const defaults = await import('./internal/macro/effect-macro-defaults.ts');
	await defaults.hydrateDefaultEffectMacroLibrary(current, runtime, EFFECT_MACRO_LIBRARY_SETTING_KEY);
}
