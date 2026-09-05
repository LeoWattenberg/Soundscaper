/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDeferredModuleFacade } from '../src/common/editor/controller/deferred-module-facade.ts';

interface FakeService {
	measure(label: string, weight?: number): Promise<string>;
	count(values: readonly number[]): number;
	dispose(): void;
}

function fakeLoader() {
	const calls: unknown[][] = [];
	let loads = 0;
	let disposed = 0;
	const load = async (): Promise<FakeService> => {
		loads += 1;
		return {
			measure: async (label: string, weight?: number) => {
				calls.push(['measure', label, weight]);
				return `${label}:${weight ?? 0}`;
			},
			count: (values: readonly number[]) => {
				calls.push(['count', values]);
				return values.length;
			},
			dispose: () => { disposed += 1; },
		};
	};
	return { load, calls, loads: () => loads, disposed: () => disposed };
}

test('a deferred facade loads nothing until one of its methods is called', () => {
	const loader = fakeLoader();
	const facade = createDeferredModuleFacade(loader.load, ['measure', 'count', 'dispose']);
	assert.equal(loader.loads(), 0);
	assert.deepEqual(Object.keys(facade).sort(), ['count', 'dispose', 'measure']);
	assert.equal(Object.isFrozen(facade), true);
});

test('concurrent calls share one load and preserve the real signatures', async () => {
	const loader = fakeLoader();
	const facade = createDeferredModuleFacade(loader.load, ['measure', 'count', 'dispose']);
	const [first, second, third] = await Promise.all([
		facade.measure('alpha'),
		facade.measure('beta', 3),
		facade.count([1, 2, 3]),
	]);
	assert.equal(first, 'alpha:0');
	assert.equal(second, 'beta:3');
	assert.equal(third, 3);
	assert.equal(loader.loads(), 1);
	assert.deepEqual(loader.calls, [
		['measure', 'alpha', undefined],
		['measure', 'beta', 3],
		['count', [1, 2, 3]],
	]);
	await facade.measure('gamma');
	assert.equal(loader.loads(), 1);
});

test('eager members are exposed as given and are never deferred', async () => {
	const loader = fakeLoader();
	let cancelled = 0;
	const facade = createDeferredModuleFacade(loader.load, ['measure', 'count'], {
		eager: { dispose: (): number => (cancelled += 1) },
	});
	assert.equal(facade.dispose(), 1);
	assert.equal(loader.loads(), 0);
	assert.equal(cancelled, 1);
	await facade.measure('alpha');
	assert.equal(loader.loads(), 1);
	assert.equal(loader.disposed(), 0);
});

test('sibling facades over one memoized loader declare each other covered and share its load', async () => {
	const loader = fakeLoader();
	let shared: Promise<FakeService> | null = null;
	const load = () => (shared ??= loader.load());
	const reads = createDeferredModuleFacade(load, ['measure', 'count'], { covered: ['dispose'] });
	const teardown = createDeferredModuleFacade(load, ['dispose'], { covered: ['measure', 'count'] });
	await reads.measure('alpha');
	await teardown.dispose();
	assert.equal(loader.disposed(), 1);
	assert.equal(loader.loads(), 1);
});

test('a rejected load is not cached, so the next call retries', async () => {
	let attempts = 0;
	const failure = new Error('chunk unavailable');
	const facade = createDeferredModuleFacade(async (): Promise<FakeService> => {
		attempts += 1;
		if (attempts === 1) throw failure;
		return {
			measure: async () => 'ok',
			count: (values: readonly number[]) => values.length,
			dispose: () => undefined,
		};
	}, ['count'], { covered: ['measure', 'dispose'] });
	await assert.rejects(facade.count([1]), (error) => error === failure);
	assert.equal(await facade.count([1, 2]), 2);
	assert.equal(attempts, 2);
});

test('a method missing from the loaded module reports the name it could not reach', async () => {
	const facade = createDeferredModuleFacade(
		async (): Promise<FakeService> => (
			{ count: () => 0, dispose: () => undefined } as unknown as FakeService
		),
		['measure'],
		{ covered: ['count', 'dispose'] },
	);
	await assert.rejects(facade.measure('alpha'), (error) => (
		error instanceof TypeError && error.message.includes('measure')
	));
});
