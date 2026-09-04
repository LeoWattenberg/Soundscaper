/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createMacroScriptLibrary,
	deleteMacroScript,
	listMacroScripts,
	saveMacroScript,
	type MacroScriptLibraryState,
	type MacroScriptRecord,
} from '../macro-script-library.ts';

export type { MacroScriptLibraryState, MacroScriptRecord };

export const MACRO_SCRIPT_LIBRARY_SETTING_KEY = 'audio-editor-macro-scripts-v1';

export interface MacroScriptLibraryServiceRuntime {
	readonly state: { macroScripts: MacroScriptLibraryState };
	readonly createId: (prefix: string) => string;
	readonly persistSetting: (
		key: string, value: MacroScriptLibraryState, options: Readonly<{ policy: 'required' }>,
	) => Promise<unknown>;
	readonly publishDocumentSnapshot: () => void;
	readonly handleError: (error: unknown) => void;
}

/**
 * The saved macro programs behind the manager's list.
 *
 * The same trailing, coalescing write the effect-macro library uses, and for
 * the same reason: the editor saves on every keystroke, and a controlled field
 * that waits on a settings round trip loses the caret.
 */
export function createMacroScriptLibraryService(runtime: MacroScriptLibraryServiceRuntime) {
	let pending: MacroScriptLibraryState | null = null;
	let writing: Promise<void> | null = null;

	return Object.freeze({ list, save, delete: remove, flush });

	function list(): readonly MacroScriptRecord[] {
		return listMacroScripts(runtime.state.macroScripts);
	}

	function save(script: unknown): MacroScriptRecord {
		const result = saveMacroScript(runtime.state.macroScripts, {
			script,
			idFactory: (prefix) => runtime.createId(prefix),
		});
		commit(result.state);
		return result.script;
	}

	function remove(scriptId: string): true {
		commit(deleteMacroScript(runtime.state.macroScripts, scriptId));
		return true;
	}

	function commit(next: MacroScriptLibraryState): void {
		runtime.state.macroScripts = next;
		runtime.publishDocumentSnapshot();
		pending = next;
		if (!writing) writing = drain();
	}

	async function drain(): Promise<void> {
		let retried: MacroScriptLibraryState | null = null;
		try {
			while (pending) {
				const value = pending;
				pending = null;
				try {
					await runtime.persistSetting(MACRO_SCRIPT_LIBRARY_SETTING_KEY, value, { policy: 'required' });
				} catch (error) {
					runtime.handleError(error);
					if (!pending && retried !== value) {
						pending = value;
						retried = value;
					}
				}
			}
		} finally {
			writing = null;
		}
	}

	async function flush(): Promise<void> {
		while (writing) await writing;
	}
}

export function createInitialMacroScriptLibrary(value?: unknown): MacroScriptLibraryState {
	return createMacroScriptLibrary(value);
}
