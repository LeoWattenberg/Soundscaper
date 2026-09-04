/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeMacroScriptEnvelope } from '../src/common/editor/macro-script-envelope.ts';
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

test('an imported program has no permission until somebody gives it one', async () => {
	const { createMacroScriptLibraryService, MACRO_SCRIPT_LIBRARY_SETTING_KEY } = await import(
		'../src/common/editor/controller/macro-script-library-service.ts'
	);
	const written: Array<[string, unknown]> = [];
	let minted = 0;
	const state = { macroScripts: createMacroScriptLibrary() };
	const service = createMacroScriptLibraryService({
		state,
		createId: (prefix: string) => `${prefix}-${++minted}`,
		persistSetting: async (key: string, value: unknown) => { written.push([key, value]); },
		publishDocumentSnapshot: () => {},
		handleError: (error: unknown) => { throw error; },
	} as never);

	const file = serializeMacroScriptEnvelope({ name: 'Sweep', source: 'await sound.select.all();' });
	const imported = service.import(file, 'sweep.soundscapemacro');
	assert.equal(imported.trust, 'imported-untrusted');
	assert.equal(imported.origin, 'sweep.soundscapemacro');
	assert.equal(imported.trustedSource, null);
	assert.equal(macroScriptIsRunnable(imported), false);
	assert.equal(service.blocked('await sound.select.all();'), true,
		'the gate is on the bytes, so passing the text straight to the runner is not a way around it');

	// Editing an imported program does not launder it: the permission would still
	// name text nobody reviewed.
	service.save({ ...imported, source: 'await sound.select.none();' });
	assert.equal(macroScriptIsRunnable(service.list()[0]!), false);
	assert.equal(service.blocked('await sound.select.none();'), true);

	const trusted = service.trust(imported.id);
	assert.equal(trusted.trust, 'imported-trusted');
	assert.equal(trusted.trustedSource, 'await sound.select.none();');
	assert.equal(service.blocked('await sound.select.none();'), false);

	// A permission is for the exact bytes it was given for. Anything else re-arms it.
	service.save({ ...trusted, source: 'await sound.effect.apply("audacity-amplify", {});' });
	assert.equal(service.blocked('await sound.effect.apply("audacity-amplify", {});'), true);

	await service.flush();
	assert.deepEqual(written.map(([key]) => key),
		Array.from({ length: written.length }, () => MACRO_SCRIPT_LIBRARY_SETTING_KEY));
	assert.throws(() => service.trust('missing'), /does not exist/u);
});

test('a program the user wrote here exports as a file that will not run itself', async () => {
	const { createMacroScriptLibraryService } = await import(
		'../src/common/editor/controller/macro-script-library-service.ts'
	);
	const state = { macroScripts: createMacroScriptLibrary() };
	const service = createMacroScriptLibraryService({
		state,
		createId: () => 'macro-script-1',
		persistSetting: async () => {},
		publishDocumentSnapshot: () => {},
		handleError: (error: unknown) => { throw error; },
	} as never);
	const saved = service.save({ name: 'Level all', source: 'await sound.select.all();' });
	assert.equal(macroScriptIsRunnable(saved), true, 'a program written here is the user\'s own');
	assert.equal(service.blocked('await sound.select.all();'), false);
	assert.equal(JSON.parse(service.export(saved.id)).kind, 'script');
	assert.throws(() => service.export('missing'), /does not exist/u);
});
