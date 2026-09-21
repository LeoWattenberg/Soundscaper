/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEffectMacroLibraryService,
	createInitialEffectMacroLibrary,
} from '../src/common/editor/controller/effects/effect-macro-library-service.ts';
import {
	createInitialMacroScriptLibrary,
	createMacroScriptLibraryService,
} from '../src/common/editor/controller/effects/macro-script-library-service.ts';

interface LibraryService {
	saveName(name: string): void;
	flush(): Promise<void>;
}

type LibraryFactory = (
	persistName: (name: string) => Promise<void>,
	handleError: (error: unknown) => void,
) => LibraryService;

const libraries: ReadonlyArray<readonly [string, LibraryFactory]> = [
	['effect macro', (persistName, handleError) => {
		const state = { effectMacros: createInitialEffectMacroLibrary() };
		const service = createEffectMacroLibraryService({
			state,
			createId: () => 'macro-a',
			persistSetting: async (_key, value) => persistName(value.macros[0]?.name ?? ''),
			publishDocumentSnapshot: () => undefined,
			handleError,
		});
		return {
			saveName: (name) => { service.save({ id: 'macro-a', name, effects: [] }); },
			flush: () => service.flush(),
		};
	}],
	['macro script', (persistName, handleError) => {
		const state = { macroScripts: createInitialMacroScriptLibrary() };
		const service = createMacroScriptLibraryService({
			state,
			createId: () => 'macro-script-a',
			persistSetting: async (_key, value) => persistName(value.scripts[0]?.name ?? ''),
			publishDocumentSnapshot: () => undefined,
			handleError,
		});
		return {
			saveName: (name) => { service.save({ id: 'macro-script-a', name, source: '' }); },
			flush: () => service.flush(),
		};
	}],
];

for (const [libraryName, createLibrary] of libraries) {
	test(`${libraryName} persistence supersedes a failed write with a newer edit`, async () => {
		let rejectFirst!: (error: Error) => void;
		const firstWrite = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
		let releaseNewest!: () => void;
		const newestWrite = new Promise<void>((resolve) => { releaseNewest = resolve; });
		const attempted: string[] = [];
		const stored: string[] = [];
		const errors: unknown[] = [];
		const service = createLibrary(async (name) => {
			attempted.push(name);
			if (attempted.length === 1) await firstWrite;
			else await newestWrite;
			stored.push(name);
		}, (error) => { errors.push(error); });

		service.saveName('One');
		service.saveName('One edited');
		const failure = new Error('settings store offline');
		rejectFirst(failure);
		await waitFor(() => attempted.length === 2);
		let flushed = false;
		const flushing = service.flush().then(() => { flushed = true; });
		await Promise.resolve();

		assert.deepEqual(attempted, ['One', 'One edited']);
		assert.deepEqual(stored, []);
		assert.equal(flushed, false, 'flush must follow the newest pending write');
		assert.deepEqual(errors, [failure]);

		releaseNewest();
		await flushing;
		assert.deepEqual(stored, ['One edited']);
	});

	test(`${libraryName} persistence retries the newest value once`, async () => {
		const errors: unknown[] = [];
		let attempts = 0;
		const service = createLibrary(async () => {
			attempts += 1;
			throw new Error(`refused ${String(attempts)}`);
		}, (error) => { errors.push(error); });

		service.saveName('One');
		await service.flush();

		assert.equal(attempts, 2);
		assert.deepEqual(errors.map((error) => (error as Error).message), ['refused 1', 'refused 2']);
	});
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20 && !predicate(); attempt += 1) await Promise.resolve();
	assert.equal(predicate(), true, 'expected asynchronous persistence to make progress');
}
