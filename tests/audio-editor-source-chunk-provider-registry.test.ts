/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { SourceChunkProviderRegistry } from '../src/common/editor/controller/source-chunk-provider-registry.ts';

test('provider replacement starts cleanup synchronously and drain waits for it', async () => {
	const cleanup = deferred<void>();
	let disposeCalls = 0;
	const prior = {
		dispose() {
			disposeCalls += 1;
			return cleanup.promise;
		},
	};
	const registry = new SourceChunkProviderRegistry<string, unknown>([['source', prior]]);

	assert.strictEqual(registry.set('source', { current: true }), registry);
	assert.equal(disposeCalls, 1);
	let drained = false;
	const draining = registry.drain().then(() => {
		drained = true;
	});
	await Promise.resolve();
	assert.equal(drained, false);

	cleanup.resolve();
	await draining;
	assert.equal(drained, true);
});

test('shared providers retire only after their final registry reference disappears', async () => {
	let disposeCalls = 0;
	const shared = {
		dispose() {
			disposeCalls += 1;
		},
	};
	const registry = new SourceChunkProviderRegistry<string, unknown>([
		['left', shared],
		['right', shared],
	]);

	assert.equal(registry.delete('left'), true);
	assert.equal(disposeCalls, 0);
	assert.strictEqual(registry.set('right', shared), registry);
	assert.equal(disposeCalls, 0);
	assert.equal(registry.delete('missing'), false);
	assert.equal(registry.delete('right'), true);
	assert.equal(disposeCalls, 1);

	registry.set('reused-after-retirement', shared);
	registry.clear();
	assert.equal(disposeCalls, 1);
	await registry.drain();
});

test('clear retires each distinct disposable provider and accepts ordinary values', async () => {
	const calls: string[] = [];
	const first = { dispose: () => calls.push('first') };
	const second = { dispose: () => calls.push('second') };
	const registry = new SourceChunkProviderRegistry<string, unknown>([
		['first', first],
		['first-alias', first],
		['ordinary', Object.freeze({ ordinary: true })],
		['second', second],
	]);

	registry.clear();
	assert.equal(registry.size, 0);
	assert.deepEqual(calls, ['first', 'second']);
	await registry.drain();
});

test('drain reports one cleanup failure exactly once', async () => {
	const failure = new Error('cleanup failed');
	const registry = new SourceChunkProviderRegistry<string, unknown>([[
		'source',
		{ dispose: () => Promise.reject(failure) },
	]]);

	registry.clear();
	await assert.rejects(registry.drain(), (error: unknown) => error === failure);
	await registry.drain();
});

test('drain aggregates cleanup failures in retirement order and consumes them', async () => {
	const firstFailure = new Error('first cleanup failed');
	const secondFailure = new Error('second cleanup failed');
	const firstCleanup = deferred<void>();
	const registry = new SourceChunkProviderRegistry<string, unknown>([
		['first', { dispose: () => firstCleanup.promise }],
		['second', { dispose: () => {
			throw secondFailure;
		} }],
	]);

	registry.clear();
	const draining = registry.drain();
	firstCleanup.reject(firstFailure);
	await assert.rejects(draining, (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [firstFailure, secondFailure]);
		return true;
	});
	await registry.drain();
});

test('drain includes cleanup work added while an earlier retirement is pending', async () => {
	const firstCleanup = deferred<void>();
	const secondCleanup = deferred<void>();
	const registry = new SourceChunkProviderRegistry<string, unknown>([
		['first', { dispose: () => firstCleanup.promise }],
		['second', { dispose: () => secondCleanup.promise }],
	]);

	registry.delete('first');
	let drained = false;
	const draining = registry.drain().then(() => {
		drained = true;
	});
	registry.delete('second');
	firstCleanup.resolve();
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(drained, false);

	secondCleanup.resolve();
	await draining;
	assert.equal(drained, true);
});

test('replacement commit detaches the prior registry and retires it after staging', async () => {
	const calls: string[] = [];
	const prior = { dispose: () => calls.push('prior') };
	const current = { dispose: () => calls.push('current') };
	const registry = new SourceChunkProviderRegistry<string, unknown>([['source', prior]]);

	const replacement = registry.beginReplacement();
	assert.equal(registry.size, 0);
	assert.deepEqual(calls, []);
	registry.set('source', current);

	await replacement.commit();
	assert.strictEqual(registry.get('source'), current);
	assert.deepEqual(calls, ['prior']);
	registry.clear();
	await registry.drain();
	assert.deepEqual(calls, ['prior', 'current']);
});

test('replacement commit preserves a detached provider that is staged again', async () => {
	let disposeCalls = 0;
	const provider = { dispose: () => {
		disposeCalls += 1;
	} };
	const registry = new SourceChunkProviderRegistry<string, unknown>([['old-key', provider]]);
	const replacement = registry.beginReplacement();
	registry.set('new-key', provider);

	await replacement.commit();
	assert.equal(disposeCalls, 0);
	registry.clear();
	await registry.drain();
	assert.equal(disposeCalls, 1);
});

test('replacement rollback drains staged providers before restoring detached providers', async () => {
	const cleanup = deferred<void>();
	let priorDisposeCalls = 0;
	let stagedDisposeCalls = 0;
	const prior = { dispose: () => {
		priorDisposeCalls += 1;
	} };
	const staged = { dispose() {
		stagedDisposeCalls += 1;
		return cleanup.promise;
	} };
	const registry = new SourceChunkProviderRegistry<string, unknown>([['source', prior]]);
	const replacement = registry.beginReplacement();
	registry.set('source', staged);

	const rollingBack = replacement.rollback();
	assert.equal(stagedDisposeCalls, 1);
	assert.equal(priorDisposeCalls, 0);
	assert.equal(registry.size, 0);
	cleanup.resolve();
	await rollingBack;

	assert.strictEqual(registry.get('source'), prior);
	assert.equal(priorDisposeCalls, 0);
});

test('replacement rollback restores detached providers before reporting cleanup failure', async () => {
	const failure = new Error('staged cleanup failed');
	const prior = Object.freeze({ stable: true });
	const registry = new SourceChunkProviderRegistry<string, unknown>([['source', prior]]);
	const replacement = registry.beginReplacement();
	registry.set('source', { dispose: () => Promise.reject(failure) });

	await assert.rejects(replacement.rollback(), (error: unknown) => error === failure);
	assert.strictEqual(registry.get('source'), prior);
	await registry.drain();
});

test('replacement rollback does not retire a detached provider staged under another key', async () => {
	let disposeCalls = 0;
	const provider = { dispose: () => {
		disposeCalls += 1;
	} };
	const registry = new SourceChunkProviderRegistry<string, unknown>([['old-key', provider]]);
	const replacement = registry.beginReplacement();
	registry.set('new-key', provider);

	await replacement.rollback();
	assert.deepEqual([...registry.entries()], [['old-key', provider]]);
	assert.equal(disposeCalls, 0);
});

test('replacement transactions are non-nestable and single-use', async () => {
	const registry = new SourceChunkProviderRegistry<string, unknown>();
	const replacement = registry.beginReplacement();
	assert.throws(() => registry.beginReplacement(), /already active/u);

	await replacement.commit();
	await assert.rejects(replacement.commit(), /already been finalized/u);
	await assert.rejects(replacement.rollback(), /already been finalized/u);
	const nextReplacement = registry.beginReplacement();
	await nextReplacement.rollback();
});

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	resolve(value: Value): void;
	reject(error: unknown): void;
}

function deferred<Value>(): Deferred<Value> {
	let resolvePromise: ((value: Value) => void) | undefined;
	let rejectPromise: ((error: unknown) => void) | undefined;
	const promise = new Promise<Value>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return {
		promise,
		resolve(value) {
			if (!resolvePromise) throw new Error('Deferred resolve was unavailable.');
			resolvePromise(value);
		},
		reject(error) {
			if (!rejectPromise) throw new Error('Deferred reject was unavailable.');
			rejectPromise(error);
		},
	};
}
