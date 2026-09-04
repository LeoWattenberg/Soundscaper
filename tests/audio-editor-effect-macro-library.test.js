/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDIO_EDITOR_EFFECT_MACRO_LIBRARY_SCHEMA_VERSION,
	createEffectMacroLibrary,
	deleteEffectMacro,
	listEffectMacros,
	saveEffectMacro,
} from '../src/common/editor/effect-macro-library.js';
import { createEffect } from '../src/common/editor/effects.js';

const invert = (id) => createEffect('audacity-invert', { id });

test('an absent or empty library normalizes to the current schema with no macros', () => {
	assert.deepEqual(createEffectMacroLibrary(), {
		schemaVersion: AUDIO_EDITOR_EFFECT_MACRO_LIBRARY_SCHEMA_VERSION,
		macros: [],
	});
	assert.deepEqual(listEffectMacros(null), []);
	assert.throws(() => createEffectMacroLibrary({ schemaVersion: 2 }), /Unsupported effect macro library schema/u);
});

test('a stored library keeps its order and rejects duplicate macro IDs', () => {
	const library = createEffectMacroLibrary({
		macros: [
			{ id: 'macro-b', name: 'Second', effects: [] },
			{ id: 'macro-a', name: 'First', effects: [invert('step-1')] },
		],
	});
	assert.deepEqual(library.macros.map(({ name }) => name), ['Second', 'First']);
	assert.equal(library.macros[1].effects[0].type, 'audacity-invert');
	assert.throws(() => createEffectMacroLibrary({
		macros: [
			{ id: 'macro-a', name: 'One', effects: [] },
			{ id: 'macro-a', name: 'Two', effects: [] },
		],
	}), /must be unique/u);
});

test('saving appends a new macro and replaces an existing one in place', () => {
	const first = saveEffectMacro(undefined, {
		macro: { id: 'macro-a', name: 'Restoration', effects: [] },
	});
	const second = saveEffectMacro(first.state, {
		macro: { id: 'macro-b', name: 'Cleanup', effects: [] },
	});
	assert.deepEqual(second.state.macros.map(({ id }) => id), ['macro-a', 'macro-b']);

	const renamed = saveEffectMacro(second.state, {
		macro: { id: 'macro-a', name: 'Restoration v2', effects: [invert('step-1')] },
	});
	assert.deepEqual(renamed.state.macros.map(({ id }) => id), ['macro-a', 'macro-b']);
	assert.equal(renamed.state.macros[0].name, 'Restoration v2');
	assert.equal(renamed.macro.effects.length, 1);
});

test('saving mints an ID for a macro that does not carry one', () => {
	const { macro } = saveEffectMacro(undefined, {
		macro: { name: 'Unsaved', effects: [] },
		idFactory: () => 'macro-minted',
	});
	assert.equal(macro.id, 'macro-minted');
});

test('deleting removes only the named macro and reports an unknown ID', () => {
	const { state } = saveEffectMacro(
		saveEffectMacro(undefined, { macro: { id: 'macro-a', name: 'One', effects: [] } }).state,
		{ macro: { id: 'macro-b', name: 'Two', effects: [] } },
	);
	assert.deepEqual(deleteEffectMacro(state, 'macro-a').macros.map(({ id }) => id), ['macro-b']);
	assert.throws(() => deleteEffectMacro(state, 'macro-c'), /does not exist/u);
});

test('the library refuses to grow past its bound', () => {
	let state;
	for (let index = 0; index < 256; index += 1) {
		state = saveEffectMacro(state, {
			macro: { id: `macro-${index}`, name: `Macro ${index}`, effects: [] },
		}).state;
	}
	assert.equal(state.macros.length, 256);
	assert.doesNotThrow(() => saveEffectMacro(state, {
		macro: { id: 'macro-8', name: 'Replaced', effects: [] },
	}));
	assert.throws(() => saveEffectMacro(state, {
		macro: { id: 'macro-overflow', name: 'Overflow', effects: [] },
	}), /library is full/u);
});
