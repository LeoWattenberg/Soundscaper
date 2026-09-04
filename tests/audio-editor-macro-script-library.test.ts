/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MACRO_SCRIPT_LIBRARY_SCHEMA_VERSION,
	createMacroScriptLibrary,
	deleteMacroScript,
	listMacroScripts,
	macroScriptIsRunnable,
	saveMacroScript,
} from '../src/common/editor/macro-script-library.ts';

test('an absent library normalizes to the current schema with no programs', () => {
	assert.deepEqual(createMacroScriptLibrary(), {
		schemaVersion: MACRO_SCRIPT_LIBRARY_SCHEMA_VERSION,
		scripts: [],
	});
	assert.deepEqual(listMacroScripts(null), []);
	assert.throws(() => createMacroScriptLibrary({ schemaVersion: 2 }), /Unsupported macro script library schema/u);
});

test('saving replaces in place and keeps the list order', () => {
	let state = saveMacroScript(undefined, {
		script: { name: 'Level', source: 'await sound.select.all();' },
		idFactory: () => 'script-a',
	}).state;
	state = saveMacroScript(state, { script: { name: 'Trim', source: '' }, idFactory: () => 'script-b' }).state;
	state = saveMacroScript(state, { script: { id: 'script-a', name: 'Level all', source: 'x' } }).state;

	assert.deepEqual(state.scripts.map(({ id, name }) => ({ id, name })), [
		{ id: 'script-a', name: 'Level all' },
		{ id: 'script-b', name: 'Trim' },
	]);
	assert.deepEqual(deleteMacroScript(state, 'script-a').scripts.map(({ id }) => id), ['script-b']);
	assert.throws(() => deleteMacroScript(state, 'script-c'), /does not exist/u);
});

test('a program is admitted with bounded fields', () => {
	assert.throws(() => saveMacroScript(undefined, { script: { name: '', source: '' }, idFactory: () => 'a' }), /needs a name/u);
	assert.throws(() => saveMacroScript(undefined, { script: { name: 'x', source: 'y' }, idFactory: () => '' }), /stable ID/u);
	assert.throws(
		() => saveMacroScript(undefined, { script: { name: 'x', source: 'y'.repeat(262_145) }, idFactory: () => 'a' }),
		/too large/u,
	);
});

test('trust is bound to the exact bytes it was granted for', () => {
	// A program the user wrote here is theirs. One that arrived from a file was
	// looked at once, and the permission is for the bytes they looked at.
	assert.equal(macroScriptIsRunnable({ trust: 'authored', source: 'anything' }), true);
	assert.equal(macroScriptIsRunnable({ trust: 'imported-untrusted', source: 'x', trustedSource: 'x' }), false);
	assert.equal(macroScriptIsRunnable({ trust: 'imported-trusted', source: 'x', trustedSource: 'x' }), true);
	assert.equal(
		macroScriptIsRunnable({ trust: 'imported-trusted', source: 'x ', trustedSource: 'x' }),
		false,
		'one character elsewhere is a different program',
	);
	// A record round-trips its trust, and an unknown trust falls back to authored
	// rather than to something more permissive by accident.
	const { script } = saveMacroScript(undefined, {
		script: { name: 'Shared', source: 'x', trust: 'imported-trusted', trustedSource: 'x', origin: 'shared.soundscapemacro' },
		idFactory: () => 'script-a',
	});
	assert.deepEqual(script, {
		id: 'script-a', name: 'Shared', source: 'x',
		trust: 'imported-trusted', trustedSource: 'x', origin: 'shared.soundscapemacro',
	});
	assert.equal(saveMacroScript(undefined, {
		script: { name: 'Odd', source: 'x', trust: 'anything' }, idFactory: () => 'a',
	}).script.trust, 'authored');
});
