/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
	bindFramescaperNativeProjectActionRuntime,
	createFramescaperNativeProjectActionSubsetRuntime,
	framescaperNativeProjectActionRuntimeFor,
	type FramescaperNativeProjectActionRuntime,
} from '../src/common/editor/ui/framescaper-native-project-actions.ts';
import {
	bindDeferredFramescaperNativeImageSequenceActionV28,
	type DeferredFramescaperNativeImageSequenceActionModuleV28,
} from '../src/framescaper/editor-controller-v31-inherited-bindings.ts';

test('deferred image-sequence binding exposes its menu surface without loading execution', async () => {
	const owner = actionOwner();
	let loads = 0;
	let creations = 0;
	const calls: unknown[] = [];
	const release = deferred<void>();
	const runtime = bindDeferredFramescaperNativeImageSequenceActionV28(
		actionOptions(owner),
		async () => {
			loads += 1;
			await release.promise;
			return actionModule(() => {
				creations += 1;
				return imageSequenceRuntime(async (request) => { calls.push(request); });
			});
		},
	);

	assert.equal(loads, 0);
	assert.equal(framescaperNativeProjectActionRuntimeFor(owner), runtime);
	assert.deepEqual(runtime.surfaces, ['render-queue-enqueue', 'image-sequence-import']);
	const first = runtime.run('image-sequence-import', { ordinal: 1 });
	const second = runtime.run('image-sequence-import', { ordinal: 2 });
	await Promise.resolve();
	assert.equal(loads, 1, 'concurrent first actions share one module load');
	release.resolve();
	await Promise.all([first, second]);
	await runtime.run('image-sequence-import', { ordinal: 3 });

	assert.equal(loads, 1);
	assert.equal(creations, 1, 'the loaded action slice is created once');
	assert.deepEqual(calls, [{ ordinal: 1 }, { ordinal: 2 }, { ordinal: 3 }]);
});

test('a failed deferred image-sequence initialization is shared, propagated, and retryable', async () => {
	const owner = actionOwner();
	const failure = new Error('image-sequence module unavailable');
	let loads = 0;
	let creations = 0;
	let runs = 0;
	const runtime = bindDeferredFramescaperNativeImageSequenceActionV28(
		actionOptions(owner),
		async () => {
			loads += 1;
			if (loads === 1) throw failure;
			return actionModule(() => {
				creations += 1;
				return imageSequenceRuntime(async () => { runs += 1; });
			});
		},
	);

	const settled = await Promise.allSettled([
		runtime.run('image-sequence-import'),
		runtime.run('image-sequence-import'),
	]);
	assert.deepEqual(settled.map(({ status }) => status), ['rejected', 'rejected']);
	for (const result of settled) {
		assert.equal(result.status === 'rejected' ? result.reason : null, failure);
	}
	assert.equal(loads, 1);
	assert.equal(creations, 0);

	await runtime.run('image-sequence-import');
	await runtime.run('image-sequence-import');
	assert.equal(loads, 2, 'a later explicit action retries failed initialization once');
	assert.equal(creations, 1);
	assert.equal(runs, 2);
});

test('ordinary image-sequence action failures retain the successfully loaded action slice', async () => {
	const owner = actionOwner();
	const failure = new Error('image-sequence admission failed');
	let loads = 0;
	let creations = 0;
	let runs = 0;
	const runtime = bindDeferredFramescaperNativeImageSequenceActionV28(
		actionOptions(owner),
		async () => {
			loads += 1;
			return actionModule(() => {
				creations += 1;
				return imageSequenceRuntime(async () => {
					runs += 1;
					if (runs === 1) throw failure;
				});
			});
		},
	);

	await assert.rejects(runtime.run('image-sequence-import'), (error) => error === failure);
	await runtime.run('image-sequence-import');
	assert.deepEqual({ loads, creations, runs }, { loads: 1, creations: 1, runs: 2 });
});

test('the F31 ready binder owns the deferred boundary and imports execution only on use', () => {
	const inherited = source('src/framescaper/editor-controller-v31-inherited-bindings.ts');
	assert.match(
		inherited,
		/import type \{\n\tBindFramescaperNativeImageSequenceActionV28Options,\n\} from '\.\/editor-native-image-sequence-action-v28\.ts'/u,
	);
	assert.match(
		inherited,
		/import\('\.\/editor-native-image-sequence-action-v28\.ts'\)/u,
	);
	assert.equal(
		existsSync(new URL(
			'../src/framescaper/editor-native-image-sequence-action-deferred-v28.ts',
			import.meta.url,
		)),
		false,
	);
});

function actionOwner(): object {
	const owner = Object.freeze({});
	bindFramescaperNativeProjectActionRuntime(owner,
		createFramescaperNativeProjectActionSubsetRuntime(['render-queue-enqueue'], {
			'render-queue-enqueue': async () => undefined,
		}));
	return owner;
}

function actionOptions(
	owner: object,
): Parameters<typeof bindDeferredFramescaperNativeImageSequenceActionV28>[0] {
	return {
		profile: Object.freeze({}), owner: owner as never,
		store: Object.freeze({}) as never,
		bridge: Object.freeze({
			capabilities: async () => ({}),
			selectImageSequence: async () => null,
			readImageSequenceFile: async () => new Uint8Array(),
			releaseImageSequence: async () => true,
			imageSequenceImport: async () => ({}),
			writeImageSequenceImportChunk: async () => ({}),
			readImageSequenceImportBody: async () => new Uint8Array(),
		}) as never,
	};
}

function actionModule(
	create: () => FramescaperNativeProjectActionRuntime,
): DeferredFramescaperNativeImageSequenceActionModuleV28 {
	return Object.freeze({
		createFramescaperNativeImageSequenceActionRuntimeV28: create,
	}) as unknown as DeferredFramescaperNativeImageSequenceActionModuleV28;
}

function imageSequenceRuntime(
	action: (request: unknown) => Promise<void>,
): FramescaperNativeProjectActionRuntime {
	return createFramescaperNativeProjectActionSubsetRuntime(['image-sequence-import'], {
		'image-sequence-import': action,
	});
}

function deferred<Value>(): Readonly<{
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value | PromiseLike<Value>) => void;
}> {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return Object.freeze({ promise, resolve });
}

function source(path: string): string {
	return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}
