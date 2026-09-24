/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEffectMacroLibrary,
	deleteEffectMacro,
	listEffectMacros,
	saveEffectMacro,
} from '../../effect-macro-library.js';
import { createCoalescingSettingPersistence } from './internal/coalescing-setting-persistence.ts';

export const EFFECT_MACRO_LIBRARY_SETTING_KEY = 'audio-editor-effect-macros-v1';

export interface EffectMacroLibraryEntry extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly name: string;
	readonly effects: readonly Readonly<Record<string, unknown>>[];
}

export interface EffectMacroLibraryState {
	readonly schemaVersion: 1;
	readonly macros: readonly EffectMacroLibraryEntry[];
	/** Defaults are seeded once, so renaming or deleting one is a lasting edit. */
	readonly defaultsInitialized?: true;
}

export interface EffectMacroLibraryServiceRuntime {
	readonly state: {
		effectMacros: EffectMacroLibraryState;
		/**
		 * Set when the saved library could not be loaded. The session refuses edits
		 * rather than saving an empty fallback over stored macros.
		 */
		effectMacrosReadOnly?: boolean;
	};
	readonly createId: (prefix: string) => string;
	readonly persistSetting: (
		key: string,
		value: EffectMacroLibraryState,
		options: Readonly<{ policy: 'required' }>,
	) => Promise<unknown>;
	readonly publishDocumentSnapshot: () => void;
	readonly handleError: (error: unknown) => void;
}

/**
 * The saved macro library behind the macro manager's list of macros.
 *
 * Writes land in memory and publish before they are stored: the manager edits a
 * macro keystroke by keystroke, and a controlled field that waits on a settings
 * round trip loses the caret. The store therefore trails the state, and only
 * the newest value is written — a burst of edits collapses into one settings
 * write rather than one per character.
 */
export function createEffectMacroLibraryService(runtime: EffectMacroLibraryServiceRuntime) {
	const persistence = createCoalescingSettingPersistence<EffectMacroLibraryState>({
		persist: (value) => runtime.persistSetting(
			EFFECT_MACRO_LIBRARY_SETTING_KEY, value, { policy: 'required' },
		),
		handleError: runtime.handleError,
	});

	return Object.freeze({
		list: listMacros,
		readOnly: isReadOnly,
		save: saveMacro,
		delete: deleteMacro,
		flush: persistence.flush,
	});

	function isReadOnly(): boolean {
		return runtime.state.effectMacrosReadOnly === true;
	}

	function assertWritable(): void {
		if (isReadOnly()) {
			throw new RangeError('The macro library is read-only because its saved data could not be loaded.');
		}
	}

	function listMacros(): readonly EffectMacroLibraryEntry[] {
		return listEffectMacros(runtime.state.effectMacros) as readonly EffectMacroLibraryEntry[];
	}

	function saveMacro(macro: unknown): EffectMacroLibraryEntry {
		assertWritable();
		const result = saveEffectMacro(runtime.state.effectMacros, {
			macro,
			idFactory: (prefix: string) => runtime.createId(prefix),
		}) as Readonly<{ state: EffectMacroLibraryState; macro: EffectMacroLibraryEntry }>;
		commit(result.state);
		return result.macro;
	}

	function deleteMacro(macroId: string): true {
		assertWritable();
		commit(deleteEffectMacro(runtime.state.effectMacros, macroId) as EffectMacroLibraryState);
		return true;
	}

	function commit(next: EffectMacroLibraryState): void {
		runtime.state.effectMacros = next;
		runtime.publishDocumentSnapshot();
		persistence.enqueue(next);
	}
}

export function createInitialEffectMacroLibrary(value?: unknown): EffectMacroLibraryState {
	return (createEffectMacroLibrary as (stored?: unknown) => unknown)(value) as EffectMacroLibraryState;
}
