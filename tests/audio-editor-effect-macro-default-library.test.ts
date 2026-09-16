/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	deleteEffectMacro,
	saveEffectMacro,
} from '../src/common/editor/effect-macro-library.js';
import {
	createInitialEffectMacroLibrary,
	type EffectMacroLibraryState,
} from '../src/common/editor/controller/effects/effect-macro-library-service.ts';
import {
	createDefaultEffectMacroLibrary,
	hydrateDefaultEffectMacroLibrary,
} from '../src/common/editor/controller/effects/effect-macro-defaults-service.ts';

test('a fresh library starts with editable Restoration and Fade ends macros', async () => {
	const library = await createDefaultEffectMacroLibrary();

	assert.equal(library.schemaVersion, 1);
	assert.equal(library.defaultsInitialized, true);
	assert.deepEqual(library.macros.map(({ name }) => name), ['Restoration', 'Fade ends']);
	assert.deepEqual(library.macros[0]?.effects.map(({ type }) => type), [
		'audacity-click-removal', 'audacity-noise-reduction', 'audacity-filter-curve-eq',
	]);
	assert.deepEqual(library.macros[1]?.effects.map((step) => step.command ?? step.type), [
		'Select', 'audacity-fade-in', 'Select', 'audacity-fade-out', 'Select',
	]);
	assert.ok(Object.isFrozen(library));
	assert.ok(Object.isFrozen(library.macros));
});

test('legacy libraries keep their entries and receive defaults once', async () => {
	const saved = { id: 'custom', name: 'My chain', effects: [] };
	const library = await createDefaultEffectMacroLibrary({ schemaVersion: 1, macros: [saved] });

	assert.deepEqual(library.macros.map(({ name }) => name), ['My chain', 'Restoration', 'Fade ends']);
	assert.equal(library.macros[0]?.id, 'custom');
	assert.deepEqual(await createDefaultEffectMacroLibrary(JSON.parse(JSON.stringify(library))), library);
});

test('renamed and deleted default macros stay changed after storage and initialization', async () => {
	const library = await createDefaultEffectMacroLibrary();
	const restoration = library.macros[0]!;
	const fadeEnds = library.macros[1]!;
	const edited = saveEffectMacro(library, {
		macro: { ...restoration, name: 'My restoration', effects: [{ type: 'audacity-invert' }] },
	}).state as EffectMacroLibraryState;
	const deleted = deleteEffectMacro(edited, fadeEnds.id) as EffectMacroLibraryState;
	const reopened = await createDefaultEffectMacroLibrary(JSON.parse(JSON.stringify(deleted)));

	assert.equal(deleted.defaultsInitialized, true, 'save and delete preserve the one-time marker');
	assert.deepEqual(reopened.macros.map(({ name }) => name), ['My restoration']);
	assert.deepEqual(reopened.macros[0]?.effects.map(({ type }) => type), ['audacity-invert']);
	const empty = deleteEffectMacro(reopened, restoration.id) as EffectMacroLibraryState;
	assert.deepEqual((await createDefaultEffectMacroLibrary(empty)).macros, []);
});

test('a legacy user macro named like a default remains an independent ordinary macro', async () => {
	const library = await createDefaultEffectMacroLibrary({
		macros: [{ id: 'mine', name: 'Restoration', effects: [] }],
	});

	assert.deepEqual(library.macros.map(({ name }) => name), ['Restoration', 'Restoration', 'Fade ends']);
	assert.equal(library.macros[0]?.id, 'mine');
	assert.equal(new Set(library.macros.map(({ id }) => id)).size, 3);
});

test('a full legacy library preserves user macros without reseeding after a later deletion', async () => {
	const library = await createDefaultEffectMacroLibrary({
		macros: Array.from({ length: 256 }, (_, index) => ({
			id: `custom-${index}`, name: `Macro ${index}`, effects: [],
		})),
	});

	assert.equal(library.macros.length, 256);
	assert.equal(library.defaultsInitialized, true);
	const deleted = deleteEffectMacro(library, 'custom-0');
	assert.equal((await createDefaultEffectMacroLibrary(deleted)).macros.length, 255);
});

test('a nearly full library only adopts the default that fits', async () => {
	const library = await createDefaultEffectMacroLibrary({
		macros: Array.from({ length: 255 }, (_, index) => ({
			id: `custom-${index}`, name: `Macro ${index}`, effects: [],
		})),
	});

	assert.equal(library.macros.length, 256);
	assert.equal(library.macros.at(-1)?.name, 'Restoration');
	assert.equal(library.defaultsInitialized, true);
});

test('defaults never convert a newer library into this build\'s writable schema', async () => {
	const future = { schemaVersion: 99, macros: [{ id: 'future', name: 'Future', steps: [] }] };

	await assert.rejects(createDefaultEffectMacroLibrary(future), /Unsupported effect macro library schema/u);
	assert.equal(future.schemaVersion, 99);
	assert.deepEqual(createInitialEffectMacroLibrary().macros, [], 'the read-only fallback stays empty');
});

test('deferred hydration publishes defaults and persists their one-time marker', async () => {
	let state = createInitialEffectMacroLibrary();
	const writes: [string, EffectMacroLibraryState][] = [];
	await hydrateDefaultEffectMacroLibrary({ macros: [{ id: 'mine', name: 'Mine', effects: [] }] }, {
		guard: async (value) => value,
		setEffectMacros: (value) => { state = value; },
		persistEffectMacroLibrary: async (key, value) => { writes.push([key, value]); },
		handleError: () => assert.fail('hydration should succeed'),
		isDisposedError: () => false,
	});

	assert.deepEqual(state.macros.map(({ name }) => name), ['Mine', 'Restoration', 'Fade ends']);
	assert.deepEqual(writes, [['audio-editor-effect-macros-v1', state]]);
});

test('deferred hydration cannot publish after its lifetime guard rejects', async () => {
	const disposed = new Error('disposed');
	await assert.rejects(hydrateDefaultEffectMacroLibrary(undefined, {
		guard: async () => { throw disposed; },
		setEffectMacros: () => assert.fail('disposed hydration must not publish'),
		persistEffectMacroLibrary: async () => assert.fail('disposed hydration must not persist'),
		handleError: () => assert.fail('disposal must propagate'),
		isDisposedError: (error) => error === disposed,
	}), disposed);
});

test('a failed migration write keeps the user macros and defaults available for a later retry', async () => {
	const storageFailure = new Error('storage quota exhausted');
	let state = createInitialEffectMacroLibrary();
	const failures: unknown[] = [];
	await hydrateDefaultEffectMacroLibrary({ macros: [{ id: 'mine', name: 'Mine', effects: [] }] }, {
		guard: async (value) => value,
		setEffectMacros: (value) => { state = value; },
		persistEffectMacroLibrary: async (_key, value) => {
			assert.equal(state, value, 'the migrated library is available before persistence settles');
			throw storageFailure;
		},
		handleError: (error) => { failures.push(error); },
		isDisposedError: () => false,
	});

	assert.equal(state.defaultsInitialized, true);
	assert.deepEqual(state.macros.map(({ name }) => name), ['Mine', 'Restoration', 'Fade ends']);
	assert.deepEqual(failures, [storageFailure]);
	assert.deepEqual(await createDefaultEffectMacroLibrary(state), state,
		'a retry must preserve the published defaults instead of duplicating them');
});

test('disposal while persisting a migration propagates instead of reporting a storage error', async () => {
	const disposed = new Error('disposed during persistence');
	let state = createInitialEffectMacroLibrary();
	await assert.rejects(hydrateDefaultEffectMacroLibrary(undefined, {
		guard: async (value) => value,
		setEffectMacros: (value) => { state = value; },
		persistEffectMacroLibrary: async () => { throw disposed; },
		handleError: () => assert.fail('disposal must propagate'),
		isDisposedError: (error) => error === disposed,
	}), disposed);

	assert.equal(state.defaultsInitialized, true);
	assert.deepEqual(state.macros.map(({ name }) => name), ['Restoration', 'Fade ends']);
});

test('an initialized empty library hydrates without restoring deleted defaults or writing storage', async () => {
	const empty = createInitialEffectMacroLibrary({ schemaVersion: 1, defaultsInitialized: true, macros: [] });
	const published: EffectMacroLibraryState[] = [];
	await hydrateDefaultEffectMacroLibrary(empty, {
		guard: async (value) => value,
		setEffectMacros: (value) => { published.push(value); },
		persistEffectMacroLibrary: async () => assert.fail('an initialized library needs no migration write'),
		handleError: () => assert.fail('hydration should succeed'),
		isDisposedError: () => false,
	});

	assert.deepEqual(published, [empty]);
});

test('hydration can adopt defaults without a persistence capability', async () => {
	const published: EffectMacroLibraryState[] = [];
	await hydrateDefaultEffectMacroLibrary(undefined, {
		guard: async (value) => value,
		setEffectMacros: (value) => { published.push(value); },
		handleError: () => assert.fail('a session without storage can still hydrate defaults'),
		isDisposedError: () => false,
	});

	assert.equal(published.length, 1);
	assert.equal(published[0]?.defaultsInitialized, true);
	assert.deepEqual(published[0]?.macros.map(({ name }) => name), ['Restoration', 'Fade ends']);
});
