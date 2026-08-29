/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	bindFramescaperNativeCarrierRegeneration,
	createFramescaperNativeProjectActionSubsetRuntime,
} from '../src/common/editor/ui/framescaper-native-project-actions.ts';
import {
	bindDeferredFramescaperNativeRenderQueueActionNativeMedia as bindRenderQueue,
} from '../src/framescaper/editor-controller-assistance-inherited-bindings.ts';

type Data = Record<string, unknown>;

function actionSlice(runs: string[]): never {
	const runtime = createFramescaperNativeProjectActionSubsetRuntime(
		['render-queue-enqueue'] as never,
		{ 'render-queue-enqueue': async () => { runs.push('render-queue-enqueue'); } } as never,
	);
	bindFramescaperNativeCarrierRegeneration(runtime, async () => undefined);
	return runtime as unknown as never;
}

function moduleLoader(
	factory: () => unknown,
	loads: { count: number },
): never {
	return (async () => {
		loads.count += 1;
		return { createFramescaperNativeRenderQueueActionRuntimeNativeMedia: factory };
	}) as unknown as never;
}

function bind(factory: () => unknown, loads: { count: number }, owner: unknown = {}): Data {
	return bindRenderQueue(
		{},
		owner as never,
		moduleLoader(factory, loads),
	) as unknown as Data;
}

test('the render-queue surface is registered without loading its execution module', () => {
	const loads = { count: 0 };
	const runs: string[] = [];

	const runtime = bind(() => actionSlice(runs), loads);

	assert.deepEqual(runtime.surfaces, ['render-queue-enqueue']);
	assert.equal(loads.count, 0, 'binding a menu action must not pull in its import pipeline');
});

test('the execution module loads once on first use and is reused afterwards', async () => {
	const loads = { count: 0 };
	const runs: string[] = [];
	const runtime = bind(() => actionSlice(runs), loads);
	const run = runtime.run as (surface: string, request: unknown) => Promise<void>;

	await run('render-queue-enqueue', {});
	assert.equal(loads.count, 1);

	await run('render-queue-enqueue', {});
	assert.equal(loads.count, 1, 'a resolved module must be memoised');
	assert.deepEqual(runs, ['render-queue-enqueue', 'render-queue-enqueue']);
});

test('a failed load is not cached, so a later use retries it', async () => {
	const loads = { count: 0 };
	const runs: string[] = [];
	let failing = true;
	const runtime = bindRenderQueue({}, {} as never, (async () => {
		loads.count += 1;
		if (failing) throw new Error('the execution module is unavailable');
		return { createFramescaperNativeRenderQueueActionRuntimeNativeMedia: () => actionSlice(runs) };
	}) as never) as unknown as Data;
	const run = runtime.run as (surface: string, request: unknown) => Promise<void>;

	await assert.rejects(() => run('render-queue-enqueue', {}), /execution module is unavailable/u);
	assert.equal(loads.count, 1);

	failing = false;
	await run('render-queue-enqueue', {});

	assert.equal(loads.count, 2, 'a rejected load must not be cached as the permanent answer');
	assert.deepEqual(runs, ['render-queue-enqueue']);
});

test('a module returning the wrong action slice is refused', async () => {
	const loads = { count: 0 };
	const runtime = bind(() => ({ surfaces: ['wrong-surface'], run: async () => undefined }), loads);
	const run = runtime.run as (surface: string, request: unknown) => Promise<void>;

	await assert.rejects(
		() => run('render-queue-enqueue', {}),
		/returned an invalid action slice/u,
	);
});

test('a deferred binding requires a controller owner it can register against', () => {
	const loads = { count: 0 };
	const runs: string[] = [];
	const loader = moduleLoader(() => actionSlice(runs), loads);

	for (const owner of [null, undefined, 'owner', 42]) {
		assert.throws(() => bindRenderQueue({}, owner as never, loader), TypeError);
	}
});
