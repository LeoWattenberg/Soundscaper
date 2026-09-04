/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEffectMacroLibrary,
	deleteEffectMacro,
	listEffectMacros,
	saveEffectMacro,
} from '../effect-macro-library.js';

export const EFFECT_MACRO_LIBRARY_SETTING_KEY = 'audio-editor-effect-macros-v1';

export interface EffectMacroLibraryEntry extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly name: string;
	readonly effects: readonly Readonly<Record<string, unknown>>[];
}

export interface EffectMacroLibraryState {
	readonly schemaVersion: 1;
	readonly macros: readonly EffectMacroLibraryEntry[];
}

export interface EffectMacroLibraryServiceRuntime {
	readonly state: { effectMacros: EffectMacroLibraryState };
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
	let pending: EffectMacroLibraryState | null = null;
	let writing: Promise<void> | null = null;

	return Object.freeze({
		list: listMacros,
		save: saveMacro,
		delete: deleteMacro,
		flush: flushMacroLibrary,
	});

	function listMacros(): readonly EffectMacroLibraryEntry[] {
		return listEffectMacros(runtime.state.effectMacros) as readonly EffectMacroLibraryEntry[];
	}

	function saveMacro(macro: unknown): EffectMacroLibraryEntry {
		const result = saveEffectMacro(runtime.state.effectMacros, {
			macro,
			idFactory: (prefix: string) => runtime.createId(prefix),
		}) as Readonly<{ state: EffectMacroLibraryState; macro: EffectMacroLibraryEntry }>;
		commit(result.state);
		return result.macro;
	}

	function deleteMacro(macroId: string): true {
		commit(deleteEffectMacro(runtime.state.effectMacros, macroId) as EffectMacroLibraryState);
		return true;
	}

	function commit(next: EffectMacroLibraryState): void {
		runtime.state.effectMacros = next;
		runtime.publishDocumentSnapshot();
		pending = next;
		if (!writing) writing = drain();
	}

	async function drain(): Promise<void> {
		try {
			while (pending) {
				const value = pending;
				pending = null;
				await runtime.persistSetting(EFFECT_MACRO_LIBRARY_SETTING_KEY, value, { policy: 'required' });
			}
		} catch (error) {
			runtime.handleError(error);
		} finally {
			writing = null;
		}
		// A write that failed leaves the newest value unstored; retry it once the
		// failing attempt has been reported rather than dropping it silently.
		if (pending && !writing) writing = drain();
	}

	/** Settles the trailing write, for callers that must observe it (tests, teardown). */
	async function flushMacroLibrary(): Promise<void> {
		while (writing) await writing;
	}
}

export function createInitialEffectMacroLibrary(value?: unknown): EffectMacroLibraryState {
	return (createEffectMacroLibrary as (stored?: unknown) => unknown)(value) as EffectMacroLibraryState;
}
