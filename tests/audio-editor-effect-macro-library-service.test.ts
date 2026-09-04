/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	EFFECT_MACRO_LIBRARY_SETTING_KEY,
	createEffectMacroLibraryService,
	createInitialEffectMacroLibrary,
} from '../src/common/editor/controller/effect-macro-library-service.ts';

test('a saved macro is readable and published before the settings write settles', async () => {
	const harness = createHarness();
	const saved = harness.service.save({ name: 'Restoration', effects: [] });

	assert.equal(saved.id, 'macro-1');
	assert.deepEqual(harness.service.list().map(({ name }) => name), ['Restoration']);
	assert.equal(harness.publications, 1);
	assert.equal(harness.writes.length, 0, 'the store must trail the state, not gate it');

	await harness.service.flush();
	assert.deepEqual(harness.writes.map(([key]) => key), [EFFECT_MACRO_LIBRARY_SETTING_KEY]);
	assert.deepEqual(harness.writes[0]?.[1], harness.state.effectMacros);
	assert.equal(harness.writes[0]?.[2], 'required');
});

test('a burst of edits collapses into one write carrying the newest value', async () => {
	const harness = createHarness();
	const macro = harness.service.save({ name: 'C', effects: [] });
	for (const name of ['Ch', 'Cha', 'Chai', 'Chain']) harness.service.save({ ...macro, name });

	assert.equal(harness.publications, 5);
	await harness.service.flush();
	assert.ok(harness.writes.length < 5, `expected coalescing, got ${harness.writes.length} writes`);
	assert.deepEqual(harness.writes.at(-1)?.[1].macros.map(({ name }) => name), ['Chain']);
	assert.deepEqual(harness.service.list().map(({ name }) => name), ['Chain']);
});

test('deleting removes the macro from state and reaches the store', async () => {
	const harness = createHarness();
	harness.service.save({ id: 'macro-a', name: 'One', effects: [] });
	harness.service.save({ id: 'macro-b', name: 'Two', effects: [] });
	await harness.service.flush();

	assert.equal(harness.service.delete('macro-a'), true);
	await harness.service.flush();
	assert.deepEqual(harness.service.list().map(({ id }) => id), ['macro-b']);
	assert.deepEqual(harness.writes.at(-1)?.[1].macros.map(({ id }) => id), ['macro-b']);
});

test('a failed write is reported and the newest value is written on the retry', async () => {
	const harness = createHarness();
	harness.failNextWrite(new Error('settings store offline'));
	harness.service.save({ id: 'macro-a', name: 'One', effects: [] });
	await harness.service.flush();

	assert.deepEqual(harness.errors.map((error) => (error as Error).message), ['settings store offline']);
	assert.deepEqual(harness.service.list().map(({ name }) => name), ['One'], 'state keeps the edit');

	harness.service.save({ id: 'macro-a', name: 'One edited', effects: [] });
	await harness.service.flush();
	assert.deepEqual(harness.writes.at(-1)?.[1].macros.map(({ name }) => name), ['One edited']);
});

test('an unstorable macro is refused without disturbing the library', () => {
	const harness = createHarness();
	harness.service.save({ id: 'macro-a', name: 'One', effects: [] });
	assert.throws(() => harness.service.save({ id: 'macro-b', name: '  ', effects: [] }), /non-empty/u);
	assert.throws(() => harness.service.delete('macro-z'), /does not exist/u);
	assert.deepEqual(harness.service.list().map(({ id }) => id), ['macro-a']);
});

test('a rejected write is retried and the flush waits for the retry to settle', async () => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const harness = createRetryHarness(async (attempt) => {
		await Promise.resolve();
		if (attempt === 1) throw new Error('settings store offline');
		await gate;
	});

	harness.service.save({ id: 'macro-a', name: 'One', effects: [] });
	let flushed = false;
	const flushing = harness.service.flush().then(() => { flushed = true; });
	await new Promise((resolve) => { setTimeout(resolve, 0); });

	assert.equal(harness.attempts(), 2, 'the failed write must be retried');
	// Read the length rather than comparing against a literal `[]`: assert.deepEqual
	// narrows its first argument to the second's type, which would leave `writes`
	// typed `never[]` for the rest of this test.
	assert.equal(harness.writes.length, 0, 'the retry has not reached the store yet');
	assert.equal(flushed, false, 'flush must not settle while the retry is outstanding');

	release();
	await flushing;
	assert.deepEqual(harness.writes.map((value) => value.macros.map(({ name }) => name)), [['One']]);
	assert.deepEqual(harness.errors.map((error) => (error as Error).message), ['settings store offline']);
});

test('an edit committed while a write is failing supersedes the failed value', async () => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const harness = createRetryHarness(async (attempt) => {
		if (attempt > 1) return;
		await gate;
		throw new Error('settings store offline');
	});

	const macro = harness.service.save({ id: 'macro-a', name: 'One', effects: [] });
	harness.service.save({ ...macro, name: 'One edited' });
	release();
	await harness.service.flush();

	assert.equal(harness.attempts(), 2, 'the superseded value must not be written as well');
	assert.deepEqual(harness.writes.map((value) => value.macros.map(({ name }) => name)), [['One edited']]);
});

test('a store that keeps refusing the write gives up after one retry', async () => {
	const harness = createRetryHarness(async (attempt) => {
		await Promise.resolve();
		if (attempt <= 5) throw new Error(`refused ${attempt}`);
	});

	harness.service.save({ id: 'macro-a', name: 'One', effects: [] });
	await harness.service.flush();

	assert.equal(harness.attempts(), 2, 'a failed write is retried once, not forever');
	assert.deepEqual(harness.errors.map((error) => (error as Error).message), ['refused 1', 'refused 2']);
	assert.deepEqual(harness.writes, []);
});

test('a read-only library refuses edits and writes nothing', async () => {
	// The session reached a library a newer build wrote. Saving anything here
	// would persist this build's shape over macros it cannot even read, so both
	// mutations have to fail before they touch state or the store.
	const harness = createHarness({ readOnly: true });

	assert.throws(() => harness.service.save({ name: 'Restoration', effects: [] }), /read-only/u);
	assert.throws(() => harness.service.delete('macro-a'), /read-only/u);

	await harness.service.flush();
	assert.deepEqual(harness.writes, [], 'a refused edit must not reach the store');
	assert.deepEqual(harness.service.list(), []);
	assert.equal(harness.publications, 0);
	assert.equal(harness.service.readOnly(), true);
});

test('an ordinary library reports itself writable and still saves', async () => {
	const harness = createHarness();
	assert.equal(harness.service.readOnly(), false);
	harness.service.save({ name: 'Restoration', effects: [] });
	await harness.service.flush();
	assert.equal(harness.writes.length, 1);
});

function createHarness({ readOnly = false }: { readOnly?: boolean } = {}) {
	const state = { effectMacros: createInitialEffectMacroLibrary(), effectMacrosReadOnly: readOnly };
	const writes: [string, typeof state.effectMacros, string][] = [];
	const errors: unknown[] = [];
	let failure: Error | null = null;
	let minted = 0;
	const service = createEffectMacroLibraryService({
		state,
		createId: (prefix: string) => `${prefix}-${(minted += 1)}`,
		persistSetting: async (key, value, { policy }) => {
			await Promise.resolve();
			if (failure) {
				const cause = failure;
				failure = null;
				throw cause;
			}
			writes.push([key, value, policy]);
		},
		publishDocumentSnapshot: () => { harness.publications += 1; },
		handleError: (error: unknown) => { errors.push(error); },
	});
	const harness = {
		errors,
		publications: 0,
		service,
		state,
		writes,
		failNextWrite: (cause: Error) => { failure = cause; },
	};
	return harness;
}

function createRetryHarness(persist: (attempt: number) => Promise<void>) {
	const state = { effectMacros: createInitialEffectMacroLibrary() };
	const writes: (typeof state.effectMacros)[] = [];
	const errors: unknown[] = [];
	let attempts = 0;
	let minted = 0;
	const service = createEffectMacroLibraryService({
		state,
		createId: (prefix: string) => `${prefix}-${(minted += 1)}`,
		persistSetting: async (_key, value) => {
			attempts += 1;
			await persist(attempts);
			writes.push(value);
		},
		publishDocumentSnapshot: () => undefined,
		handleError: (error: unknown) => { errors.push(error); },
	});
	return { attempts: () => attempts, errors, service, writes };
}
