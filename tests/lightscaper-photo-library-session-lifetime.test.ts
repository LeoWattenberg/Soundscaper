/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibrarySessionLifetime } from '../src/lightscaper/controller/photo-library-session-lifetime.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;

test('the current Session writer is single and Close joins every admitted reader before cleanup', async () => {
	const lifetime = new PhotoLibrarySessionLifetime(), entered = deferred<void>(), reading = deferred<void>(), release = deferred<void>();
	let cleaned = false;
	const write = lifetime.mutation(async () => { entered.resolve(); await release.promise; return 'native ACK'; });
	await entered.promise;
	await assert.rejects(lifetime.mutation(async () => 'second writer'), /pending/u);
	const read = lifetime.operation(async () => { reading.resolve(); await release.promise; return 'read'; });
	await reading.promise;
	const closing = lifetime.close(async () => { cleaned = true; });
	assert.equal(lifetime.close(async () => assert.fail('second cleanup')), closing);
	await remainsPending(closing); assert.equal(cleaned, false);
	await assert.rejects(lifetime.operation(async () => assert.fail('closed work')), /closed/u);
	release.resolve(); assert.equal(await write, 'native ACK'); assert.equal(await read, 'read');
	await closing; assert.equal(cleaned, true);
});

for (const reason of [null, NaN, -0]) test(`the first caller cancellation survives subsequent Session Close (${Object.is(reason, -0) ? '-0' : String(reason)})`, async () => {
	const lifetime = new PhotoLibrarySessionLifetime(), caller = new AbortController(), entered = deferred<void>(), release = deferred<void>();
	const result = lifetime.operation(async signal => { entered.resolve(); await release.promise; Reflect.apply(CHECK, signal, []); }, caller.signal);
	const observed = result.then(() => assert.fail('cancelled operation delivered'), error => { assert.equal(Object.is(error, reason), true); });
	await entered.promise; caller.abort(reason);
	const closing = lifetime.close(async () => undefined);
	await remainsPending(closing); release.resolve(); await observed; await closing;
});

test('opaque native cancellation is preserved without reason reflection or signal instance methods', async () => {
	const lifetime = new PhotoLibrarySessionLifetime(), caller = new AbortController(), entered = deferred<void>(), release = deferred<void>();
	let reflections = 0;
	const reason = new Proxy({}, { get() { reflections++; throw new Error('opaque get'); }, getPrototypeOf() { reflections++; throw new Error('opaque prototype'); } });
	for (const key of ['aborted', 'reason', 'addEventListener', 'removeEventListener', 'throwIfAborted']) {
		Object.defineProperty(caller.signal, key, { get() { reflections++; throw new Error('shadow signal'); } });
	}
	const result = lifetime.operation(async signal => { entered.resolve(); await release.promise; Reflect.apply(CHECK, signal, []); }, caller.signal);
	const observed = result.then(() => assert.fail('cancelled operation delivered'), error => { assert.equal(error === reason, true); });
	await entered.promise; caller.abort(reason); const closing = lifetime.close(async () => undefined);
	release.resolve(); await observed; await closing; assert.equal(reflections, 0);
});

test('Close is cached before native cancellation callbacks can reenter retirement', async () => {
	const lifetime = new PhotoLibrarySessionLifetime(), entered = deferred<void>(), release = deferred<void>();
	const nested: { closing: Promise<void> | null } = { closing: null };
	let cleanups = 0;
	const result = lifetime.operation(async signal => {
		Reflect.apply(EventTarget.prototype.addEventListener, signal, ['abort', () => {
			nested.closing = lifetime.close(async () => { cleanups++; });
		}, { once: true }]);
		entered.resolve(); await release.promise;
	});
	await entered.promise;
	const closing = lifetime.close(async () => { cleanups++; });
	assert.equal(nested.closing, closing); await remainsPending(closing);
	release.resolve(); await result; await closing; assert.equal(cleanups, 1);
});

test('a known operation ACK wins late caller abort and Close, without a post-ACK veto', async () => {
	const lifetime = new PhotoLibrarySessionLifetime(), caller = new AbortController();
	const receipt = Object.freeze({ revision: 7 });
	const nested: { closing: Promise<void> | null } = { closing: null };
	const result = lifetime.mutation(async () => {
		caller.abort(Object.freeze({ late: true })); nested.closing = lifetime.close(async () => undefined); return receipt;
	}, caller.signal);
	assert.equal(await result, receipt); assert.ok(nested.closing); await nested.closing;
});

test('closed and invalid signal admission cannot invoke work or inspect hostile reasons', async () => {
	const lifetime = new PhotoLibrarySessionLifetime();
	let calls = 0;
	await assert.rejects(lifetime.operation(async () => { calls++; }, {} as AbortSignal));
	await lifetime.close(async () => undefined);
	const hostile = new Proxy({}, { get() { calls++; throw new Error('hostile'); }, getPrototypeOf() { calls++; throw new Error('hostile'); } });
	await assert.rejects(lifetime.operation(async () => { calls++; }, hostile as AbortSignal), /closed/u);
	await assert.rejects(lifetime.mutation(async () => { calls++; }, hostile as AbortSignal), /closed/u);
	assert.equal(calls, 0);
});

test('cleanup failures retain exact identity on every subsequent Close', async () => {
	const lifetime = new PhotoLibrarySessionLifetime(), failure = Object.freeze({ cleanup: false });
	const closing = lifetime.close(() => Promise.reject(failure));
	await closing.then(() => assert.fail('cleanup unexpectedly passed'), error => { assert.equal(error === failure, true); });
	assert.equal(lifetime.close(async () => undefined), closing);
});

test('trusted admission finishes before operation returns while resource work stays deferred', async () => {
	const lifetime = new PhotoLibrarySessionLifetime(), value = { revision: 1 };
	let admitted = 0, ran = false;
	const work = lifetime.operation(async () => { ran = true; return admitted; }, undefined, () => { admitted = value.revision; });
	try {
		assert.equal(admitted, 1); assert.equal(ran, false); value.revision = 9;
		assert.equal(await work, 1);
	} finally { await lifetime.close(async () => undefined); }
});

test('trusted admission cannot reflect inputs or acquire resources after native pre-abort', async () => {
	const lifetime = new PhotoLibrarySessionLifetime(), caller = new AbortController();
	const reason = new Proxy({}, { get() { assert.fail('opaque reason reflected'); } });
	let calls = 0; caller.abort(reason);
	const work = lifetime.operation(async () => { calls++; }, caller.signal, () => { calls++; });
	await work.then(() => assert.fail('pre-aborted operation delivered'), error => { assert.equal(error === reason, true); });
	await lifetime.close(async () => undefined); assert.equal(calls, 0);
});

test('admission reentry into Close joins its already-owned work without starting acquisition', async () => {
	const lifetime = new PhotoLibrarySessionLifetime(); let ran = false, cleanups = 0;
	const state: { closing: Promise<void> | null } = { closing: null };
	const work = lifetime.operation(async () => { ran = true; }, undefined, () => {
		state.closing = lifetime.close(async () => { cleanups++; });
		assert.equal(lifetime.close(async () => assert.fail('second cleanup')), state.closing);
		assert.equal(cleanups, 0);
	});
	const observed = work.then(() => false, error => error instanceof DOMException && error.name === 'AbortError');
	try {
		assert.ok(state.closing); assert.equal(await observed, true); await state.closing;
		assert.equal(ran, false); assert.equal(cleanups, 1);
	} finally { await lifetime.close(async () => undefined); }
});

test('a native abort during throwing admission wins the later validation error without reflecting its reason', async () => {
	const lifetime = new PhotoLibrarySessionLifetime(), caller = new AbortController(); let ran = false;
	const reason = new Proxy({}, { get() { assert.fail('opaque reason reflected'); } });
	const work = lifetime.operation(async () => { ran = true; }, caller.signal, () => {
		caller.abort(reason); throw new TypeError('Later validation failure');
	});
	await work.then(() => assert.fail('cancelled admission delivered'), error => { assert.equal(error === reason, true); });
	await lifetime.close(async () => undefined); assert.equal(ran, false);
});

test('failed synchronous admission retains its exact failure and never starts deferred resource work', async () => {
	const lifetime = new PhotoLibrarySessionLifetime(), failure = Object.freeze({ admission: false }); let ran = false;
	const work = lifetime.operation(async () => { ran = true; }, undefined, () => { throw failure; });
	await work.then(() => assert.fail('failed admission delivered'), error => { assert.equal(error === failure, true); });
	await lifetime.close(async () => undefined); assert.equal(ran, false);
});
