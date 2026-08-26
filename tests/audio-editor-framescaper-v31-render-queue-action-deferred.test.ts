/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	bindFramescaperNativeCarrierRegeneration,
	createFramescaperNativeProjectActionSubsetRuntime,
	framescaperNativeProjectActionRuntimeFor,
	hasFramescaperNativeCarrierRegeneration,
	runFramescaperNativeCarrierRegeneration,
	type FramescaperNativeProjectActionRuntime,
} from '../src/common/editor/ui/framescaper-native-project-actions.ts';
import {
	bindDeferredFramescaperNativeRenderQueueActionV28,
	type DeferredFramescaperNativeRenderQueueActionModuleV28,
} from '../src/framescaper/editor-controller-v31-inherited-bindings.ts';
import {
	createFramescaperNativeRenderQueueActionRuntimeV28,
} from '../src/framescaper/editor-native-render-queue-action-v28.ts';
import {
	FRAMESCAPER_V28_RENDER_QUEUE_RESERVATIONS,
} from '../src/framescaper/editor-native-render-queue-reservations-v28.ts';

const JOB_ID = 'ab'.repeat(20);

test('the V28 render-queue factory creates an unbound exact action slice', () => {
	const owner = Object.freeze({ project: Object.freeze({}) });
	const runtime = createFramescaperNativeRenderQueueActionRuntimeV28(Object.freeze({}), owner);

	assert.equal(framescaperNativeProjectActionRuntimeFor(owner), null);
	assert.deepEqual(runtime.surfaces, ['render-queue-enqueue']);
	assert.equal(hasFramescaperNativeCarrierRegeneration(runtime), true);
});

test('deferred F31 render queue registers synchronously and shares one first execution load', async () => {
	const owner = Object.freeze({ project: Object.freeze({}) });
	const release = deferred<void>();
	const actions: unknown[] = [];
	const regenerations: string[] = [];
	let loads = 0;
	let creations = 0;
	const runtime = bindDeferredFramescaperNativeRenderQueueActionV28(
		Object.freeze({}), owner, async () => {
			loads += 1;
			await release.promise;
			return renderQueueModule(() => {
				creations += 1;
				return renderQueueRuntime(
					async (request) => { actions.push(request); },
					async (jobId) => { regenerations.push(jobId); },
				);
			});
		},
	);

	assert.equal(loads, 0);
	assert.equal(framescaperNativeProjectActionRuntimeFor(owner), runtime);
	assert.deepEqual(runtime.surfaces, ['render-queue-enqueue']);
	assert.equal(hasFramescaperNativeCarrierRegeneration(runtime), true);
	const action = runtime.run('render-queue-enqueue', { ordinal: 1 });
	const regeneration = runFramescaperNativeCarrierRegeneration(runtime, JOB_ID);
	await Promise.resolve();
	assert.equal(loads, 1, 'action and carrier regeneration share the first module load');
	release.resolve();
	await Promise.all([action, regeneration]);
	await runtime.run('render-queue-enqueue', { ordinal: 2 });
	await runFramescaperNativeCarrierRegeneration(runtime, JOB_ID);

	assert.deepEqual({ loads, creations }, { loads: 1, creations: 1 });
	assert.deepEqual(actions, [{ ordinal: 1 }, { ordinal: 2 }]);
	assert.deepEqual(regenerations, [JOB_ID, JOB_ID]);
});

test('deferred render-queue initialization failures are shared and retryable', async () => {
	const owner = Object.freeze({ project: Object.freeze({}) });
	const failure = new Error('render-queue module unavailable');
	let loads = 0;
	let creations = 0;
	let actions = 0;
	let regenerations = 0;
	const runtime = bindDeferredFramescaperNativeRenderQueueActionV28(
		Object.freeze({}), owner, async () => {
			loads += 1;
			if (loads === 1) throw failure;
			return renderQueueModule(() => {
				creations += 1;
				return renderQueueRuntime(
					async () => { actions += 1; },
					async () => { regenerations += 1; },
				);
			});
		},
	);

	const settled = await Promise.allSettled([
		runtime.run('render-queue-enqueue'),
		runFramescaperNativeCarrierRegeneration(runtime, JOB_ID),
	]);
	assert.deepEqual(settled.map(({ status }) => status), ['rejected', 'rejected']);
	for (const result of settled) {
		assert.equal(result.status === 'rejected' ? result.reason : null, failure);
	}
	assert.deepEqual({ loads, creations }, { loads: 1, creations: 0 });

	await runtime.run('render-queue-enqueue');
	await runFramescaperNativeCarrierRegeneration(runtime, JOB_ID);
	assert.deepEqual(
		{ loads, creations, actions, regenerations },
		{ loads: 2, creations: 1, actions: 1, regenerations: 1 },
	);
});

test('ordinary deferred render-queue execution failures retain the loaded runtime', async () => {
	const owner = Object.freeze({ project: Object.freeze({}) });
	const actionFailure = new Error('queue admission failed');
	const regenerationFailure = new Error('carrier regeneration failed');
	let loads = 0;
	let creations = 0;
	let actions = 0;
	let regenerations = 0;
	const runtime = bindDeferredFramescaperNativeRenderQueueActionV28(
		Object.freeze({}), owner, async () => {
			loads += 1;
			return renderQueueModule(() => {
				creations += 1;
				return renderQueueRuntime(
					async () => {
						actions += 1;
						if (actions === 1) throw actionFailure;
					},
					async () => {
						regenerations += 1;
						if (regenerations === 1) throw regenerationFailure;
					},
				);
			});
		},
	);

	await assert.rejects(runtime.run('render-queue-enqueue'), (error) => error === actionFailure);
	await assert.rejects(
		runFramescaperNativeCarrierRegeneration(runtime, JOB_ID),
		(error) => error === regenerationFailure,
	);
	await runtime.run('render-queue-enqueue');
	await runFramescaperNativeCarrierRegeneration(runtime, JOB_ID);
	assert.deepEqual(
		{ loads, creations, actions, regenerations },
		{ loads: 1, creations: 1, actions: 2, regenerations: 2 },
	);
});

test('shared V28 queue reservations do not statically pin render execution', () => {
	assert.deepEqual(FRAMESCAPER_V28_RENDER_QUEUE_RESERVATIONS, {
		cpuCores: 2,
		processTreeRssBytes: 4 * 1_024 ** 3,
		scratchBytes: 32 * 1_024 ** 3,
		minimumFreeBytes: 10 * 1_024 ** 3,
		hardwareBackend: null,
	});
	const action = source('src/framescaper/editor-native-render-queue-action-v28.ts');
	const proxy = source('src/framescaper/editor-native-prores-proxy-candidate-v28.ts');
	for (const consumer of [action, proxy]) {
		assert.match(
			consumer,
			/from '\.\/editor-native-render-queue-reservations-v28\.ts'/u,
		);
	}
	assert.doesNotMatch(
		proxy,
		/from '\.\/editor-native-render-queue-action-v28\.ts'/u,
	);
});

test('the F31 binder reaches render-queue execution through only a dynamic import', () => {
	const inherited = source('src/framescaper/editor-controller-v31-inherited-bindings.ts');
	assert.match(
		inherited,
		/import type \{\n\tFramescaperNativeRenderQueueProjectOwnerV28,\n\} from '\.\/editor-native-render-queue-action-v28\.ts'/u,
	);
	assert.match(inherited, /import\('\.\/editor-native-render-queue-action-v28\.ts'\)/u);
	assert.doesNotMatch(
		inherited,
		/import \{[^}]*bindFramescaperNativeRenderQueueActionV28[^}]*\} from '\.\/editor-native-render-queue-action-v28\.ts'/su,
	);
});

function renderQueueModule(
	create: () => FramescaperNativeProjectActionRuntime,
): DeferredFramescaperNativeRenderQueueActionModuleV28 {
	return Object.freeze({
		createFramescaperNativeRenderQueueActionRuntimeV28: create,
	}) as unknown as DeferredFramescaperNativeRenderQueueActionModuleV28;
}

function renderQueueRuntime(
	action: (request: unknown) => Promise<void>,
	regenerate: (jobId: string) => Promise<void>,
): FramescaperNativeProjectActionRuntime {
	const runtime = createFramescaperNativeProjectActionSubsetRuntime(['render-queue-enqueue'], {
		'render-queue-enqueue': action,
	});
	bindFramescaperNativeCarrierRegeneration(runtime, regenerate);
	return runtime;
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
