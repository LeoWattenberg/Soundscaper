/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeEffectMacroDraft } from './effect-macros.js';

export const AUDIO_EDITOR_EFFECT_MACRO_LIBRARY_SCHEMA_VERSION = 1;

const MAX_LIBRARY_MACROS = 256;

/**
 * The saved macros a user keeps between sessions. A macro is stored as the same
 * settings-only draft the macro manager edits, so a library entry and the draft
 * the manager runs are the same shape; nothing has to be translated between the
 * list on the left of the manager and the steps on its right.
 */
export function createEffectMacroLibrary(value = {}) {
	const source = value && typeof value === 'object' ? value : {};
	if (source.schemaVersion != null
		&& source.schemaVersion !== AUDIO_EDITOR_EFFECT_MACRO_LIBRARY_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported effect macro library schema: ${source.schemaVersion}.`);
	}
	const macros = Array.isArray(source.macros)
		? source.macros.map((macro) => normalizeEffectMacroDraft(macro))
		: [];
	return freezeLibrary(macros);
}

/**
 * Whether a stored library was written by a build newer than this one.
 *
 * This is not the same failure as a corrupt library, and the difference decides
 * whether the user keeps their macros. A library this build cannot read because
 * it is newer must be left exactly where it is: replacing it with an empty one
 * and then saving over it destroys every macro a later build stored. A caller
 * that sees this keeps the session read-only instead.
 */
export function effectMacroLibrarySchemaIsAhead(value) {
	const source = value && typeof value === 'object' ? value : {};
	return typeof source.schemaVersion === 'number'
		&& Number.isFinite(source.schemaVersion)
		&& source.schemaVersion > AUDIO_EDITOR_EFFECT_MACRO_LIBRARY_SCHEMA_VERSION;
}

export function listEffectMacros(state) {
	return createEffectMacroLibrary(state).macros;
}

/**
 * Writes one macro into the library, replacing the entry that already carries
 * its ID and otherwise appending. Replacement keeps the entry's position so a
 * rename or an edited step does not reshuffle the list under the pointer.
 */
export function saveEffectMacro(state, options = {}) {
	const current = createEffectMacroLibrary(state);
	const macro = normalizeEffectMacroDraft(options.macro ?? options, {
		...(typeof options.idFactory === 'function' ? { idFactory: options.idFactory } : {}),
	});
	const index = current.macros.findIndex((candidate) => candidate.id === macro.id);
	if (index < 0 && current.macros.length >= MAX_LIBRARY_MACROS) {
		throw new RangeError('The macro library is full.');
	}
	const macros = index < 0
		? [...current.macros, macro]
		: current.macros.map((candidate, at) => at === index ? macro : candidate);
	return { state: freezeLibrary(macros), macro };
}

export function deleteEffectMacro(state, macroId) {
	const current = createEffectMacroLibrary(state);
	const id = String(macroId ?? '');
	if (!current.macros.some((macro) => macro.id === id)) {
		throw new ReferenceError(`Effect macro ${id} does not exist.`);
	}
	return freezeLibrary(current.macros.filter((macro) => macro.id !== id));
}

function freezeLibrary(macros) {
	if (new Set(macros.map(({ id }) => id)).size !== macros.length) {
		throw new RangeError('Effect macro IDs must be unique.');
	}
	if (macros.length > MAX_LIBRARY_MACROS) throw new RangeError('The macro library is full.');
	return Object.freeze({
		schemaVersion: AUDIO_EDITOR_EFFECT_MACRO_LIBRARY_SCHEMA_VERSION,
		macros: Object.freeze(macros),
	});
}
