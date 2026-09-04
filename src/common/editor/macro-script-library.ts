/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The macro programs a user keeps between sessions.
 *
 * Deliberately a sibling of the effect-macro library rather than a new version
 * of it. Bumping that library's schema would make an older build reject the
 * whole thing and then save over it, so a user who opened a stale build would
 * lose every macro they had. A separate key means an older build simply does
 * not read this one.
 *
 * A record carries the trust the program has earned rather than a flag, and the
 * permission is for the exact bytes it was given for. A program written here is
 * the user's own and runs. One that arrived from a file runs only after somebody
 * has read it and said so — and editing it afterwards does not launder it,
 * because the permission still names the text that was actually reviewed.
 */

export const MACRO_SCRIPT_LIBRARY_SCHEMA_VERSION = 1;

const MAX_LIBRARY_SCRIPTS = 128;
const MAX_NAME_CODE_UNITS = 256;
const MAX_SOURCE_CODE_UNITS = 256 * 1024;

export type MacroScriptTrust = 'authored' | 'imported-untrusted' | 'imported-trusted';

export interface MacroScriptRecord {
	readonly id: string;
	readonly name: string;
	readonly source: string;
	readonly trust: MacroScriptTrust;
	/** The source this trust was granted for; anything else re-arms the gate. */
	readonly trustedSource: string | null;
	readonly origin: string | null;
}

export interface MacroScriptLibraryState {
	readonly schemaVersion: typeof MACRO_SCRIPT_LIBRARY_SCHEMA_VERSION;
	readonly scripts: readonly MacroScriptRecord[];
}

export interface MacroScriptSaveOptions {
	readonly script: unknown;
	readonly idFactory?: (prefix: string) => string;
}

export function createMacroScriptLibrary(value: unknown = {}): MacroScriptLibraryState {
	const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
	if (source.schemaVersion != null && source.schemaVersion !== MACRO_SCRIPT_LIBRARY_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported macro script library schema: ${String(source.schemaVersion)}.`);
	}
	const scripts = Array.isArray(source.scripts)
		? source.scripts.map((script) => normalizeMacroScript(script))
		: [];
	return freezeLibrary(scripts);
}

export function listMacroScripts(state: unknown): readonly MacroScriptRecord[] {
	return createMacroScriptLibrary(state).scripts;
}

export function saveMacroScript(
	state: unknown,
	options: MacroScriptSaveOptions,
): Readonly<{ state: MacroScriptLibraryState; script: MacroScriptRecord }> {
	const current = createMacroScriptLibrary(state);
	const mint = options.idFactory ?? (() => `macro-script-${current.scripts.length + 1}`);
	const script = normalizeMacroScript({
		id: mint('macro-script'),
		...(options.script && typeof options.script === 'object' ? options.script : {}),
	});
	const index = current.scripts.findIndex((candidate) => candidate.id === script.id);
	if (index < 0 && current.scripts.length >= MAX_LIBRARY_SCRIPTS) {
		throw new RangeError('The macro program library is full.');
	}
	const scripts = index < 0
		? [...current.scripts, script]
		: current.scripts.map((candidate, at) => at === index ? script : candidate);
	return Object.freeze({ state: freezeLibrary(scripts), script });
}

export function deleteMacroScript(state: unknown, scriptId: string): MacroScriptLibraryState {
	const current = createMacroScriptLibrary(state);
	const id = String(scriptId ?? '');
	if (!current.scripts.some((script) => script.id === id)) {
		throw new ReferenceError(`Macro program ${id} does not exist.`);
	}
	return freezeLibrary(current.scripts.filter((script) => script.id !== id));
}

/**
 * Whether this exact program may run.
 *
 * A program the user wrote here is theirs. One that arrived from a file has to
 * be looked at, and the permission is for the bytes they looked at — a single
 * character elsewhere is a different program.
 */
export function macroScriptIsRunnable(script: Readonly<Partial<MacroScriptRecord>>): boolean {
	if (script.trust === 'authored') return true;
	return script.trust === 'imported-trusted' && script.trustedSource === script.source;
}

/**
 * Grant this program permission to run, for exactly the bytes it holds now.
 *
 * The permission is not a flag on the record but a copy of the source it was
 * given for, so a later edit — from a re-import, from a sync, from anything
 * that is not the user typing here — leaves the record trusted for a program
 * that is no longer in it, and it stops being runnable.
 */
export function trustMacroScript(state: unknown, scriptId: string): MacroScriptLibraryState {
	const current = createMacroScriptLibrary(state);
	const id = String(scriptId ?? '');
	const script = current.scripts.find((candidate) => candidate.id === id);
	if (!script) throw new ReferenceError(`Macro program ${id} does not exist.`);
	return freezeLibrary(current.scripts.map((candidate) => candidate.id === id
		? normalizeMacroScript({ ...candidate, trust: 'imported-trusted', trustedSource: script.source })
		: candidate));
}

/**
 * Whether this exact text is text the user has been shown and has not enabled.
 *
 * The gate lives on the bytes rather than on the record, because the run action
 * is handed a name and a source rather than a library ID. Checking the record
 * would leave the obvious bypass — read the untrusted program out of the list
 * and pass its text straight to the runner — open.
 */
export function macroScriptSourceIsBlocked(
	scripts: readonly Readonly<Partial<MacroScriptRecord>>[],
	source: string,
): boolean {
	const text = String(source ?? '');
	return scripts.some((script) => script.source === text && !macroScriptIsRunnable(script));
}

export function normalizeMacroScript(value: unknown): MacroScriptRecord {
	const script = value && typeof value === 'object' ? value as Record<string, unknown> : {};
	const id = String(script.id ?? '').trim();
	if (!id || id.length > 1_024) throw new TypeError('A macro program needs a bounded stable ID.');
	const name = String(script.name ?? '').trim();
	if (!name) throw new TypeError('A macro program needs a name.');
	if (name.length > MAX_NAME_CODE_UNITS) throw new RangeError('The macro program name is too long.');
	const source = String(script.source ?? '');
	if (source.length > MAX_SOURCE_CODE_UNITS) throw new RangeError('The macro program is too large.');
	const trust = script.trust === 'imported-untrusted' || script.trust === 'imported-trusted'
		? script.trust
		: 'authored';
	return Object.freeze({
		id,
		name,
		source,
		trust,
		trustedSource: trust === 'imported-trusted' && typeof script.trustedSource === 'string'
			? script.trustedSource
			: null,
		origin: typeof script.origin === 'string' && script.origin ? script.origin : null,
	});
}

function freezeLibrary(scripts: readonly MacroScriptRecord[]): MacroScriptLibraryState {
	if (new Set(scripts.map(({ id }) => id)).size !== scripts.length) {
		throw new RangeError('Macro program IDs must be unique.');
	}
	if (scripts.length > MAX_LIBRARY_SCRIPTS) throw new RangeError('The macro program library is full.');
	return Object.freeze({
		schemaVersion: MACRO_SCRIPT_LIBRARY_SCHEMA_VERSION,
		scripts: Object.freeze([...scripts]),
	});
}
