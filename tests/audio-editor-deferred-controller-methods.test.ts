/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deferControllerMethods, deferAsyncControllerMethods } from '../src/common/editor/controller/composition/internal/deferred-controller-methods.ts';

test('controller bindings defer access until invocation and preserve receivers and results', () => {
	let reads = 0;
	const service = { count: 0, increment(amount = 1) { return this.count += amount; } };
	const { increment } = deferControllerMethods(() => { reads++; return service; }, ['increment']);
	assert.equal(reads, 0);
	assert.equal(increment(), 1);
	assert.equal(increment(4), 5);
	assert.equal(reads, 2);
	assert.equal(service.count, 5);
});

test('controller bindings retain asynchronous and exceptional behavior', async () => {
	const failure = new Error('failed');
	const pending = Promise.resolve('ready');
	const service = { ready: () => pending, fail: () => { throw failure; } };
	const binding = deferControllerMethods(() => service, ['ready', 'fail']);
	assert.equal(binding.ready(), pending);
	assert.equal(await binding.ready(), 'ready');
	assert.throws(() => binding.fail(), (error: unknown) => error === failure);
	assert.ok(Object.isFrozen(binding));
});

// Compiled, never invoked: a binding must keep its owner's contract.
export function checkBindingTypes(): void {
	const service = { label: 'counter', count: (value: number) => String(value) };
	const binding = deferControllerMethods(() => service, ['count']);
	const result: string = binding.count(1);
	void result;
	// @ts-expect-error A service data field is not a callable port.
	deferControllerMethods(() => service, ['label']);
	// @ts-expect-error Unknown method names cannot cross the composition boundary.
	deferControllerMethods(() => service, ['missing']);
	// @ts-expect-error Forwarding must not widen a parameter to any.
	binding.count('1');
}


test('async controller bindings turn synchronous failures into rejected promises', async () => {
	let reads = 0;
	const failure = new Error('failed');
	const service = { count: 2, read(amount: number) { return this.count + amount; }, fail() { throw failure; } };
	const binding = deferAsyncControllerMethods(() => { reads++; return service; }, ['read', 'fail']);
	assert.equal(reads, 0);
	assert.equal(await binding.read(3), 5);
	let result: Promise<never> | undefined;
	assert.doesNotThrow(() => { result = binding.fail(); });
	await assert.rejects(result!, (error: unknown) => error === failure);
});
