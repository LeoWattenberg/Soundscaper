/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createPreparedProjectSources } from '../src/common/editor/controller/prepared-project-sources.ts';
import { SourceChunkProviderRegistry } from '../src/common/editor/controller/source-chunk-provider-registry.ts';

test('prepared provider publication transfers ownership before awaiting prior cleanup', async () => {
	const cleanup = deferred<void>();
	let priorDisposals = 0;
	let candidateDisposals = 0;
	const prior = Object.freeze({
		dispose() {
			priorDisposals += 1;
			return cleanup.promise;
		},
	});
	const candidate = Object.freeze({
		dispose() { candidateDisposals += 1; },
	});
	const providers = new SourceChunkProviderRegistry<string, unknown>([['source', prior]]);
	const prepared = new Map([[
		'source',
		Object.freeze({ kind: 'provider' as const, value: candidate }),
	]]);
	const ownership = createPreparedProjectSources({
		prepared,
		sourceBuffers: new Map(),
		sourceChunkProviders: providers,
		cacheSourceBuffer: () => undefined,
		throwIfAborted: () => undefined,
	});
	let settled = false;
	const committing = ownership.commit((inputs) => {
		assert.strictEqual(inputs.chunkSources.get('source'), candidate);
		return 'applied';
	}).then((result) => {
		settled = true;
		return result;
	});

	await Promise.resolve();
	await Promise.resolve();
	assert.equal(priorDisposals, 1);
	assert.equal(candidateDisposals, 0);
	assert.equal(settled, false);
	assert.strictEqual(providers.get('source'), candidate);
	cleanup.resolve();
	assert.equal(await committing, 'applied');
	await ownership.discard();
	assert.equal(candidateDisposals, 0);

	providers.clear();
	await providers.drain();
	assert.equal(candidateDisposals, 1);
});

test('cleanup failure after publication leaves the candidate registry-owned', async () => {
	const cleanupFailure = new Error('prior cleanup failed');
	let candidateDisposals = 0;
	const candidate = Object.freeze({
		dispose() { candidateDisposals += 1; },
	});
	const providers = new SourceChunkProviderRegistry<string, unknown>([[
		'source',
		Object.freeze({ dispose: () => Promise.reject(cleanupFailure) }),
	]]);
	const ownership = createPreparedProjectSources({
		prepared: new Map([[
			'source',
			Object.freeze({ kind: 'provider' as const, value: candidate }),
		]]),
		sourceBuffers: new Map(),
		sourceChunkProviders: providers,
		cacheSourceBuffer: () => undefined,
		throwIfAborted: () => undefined,
	});

	await assert.rejects(ownership.commit(() => undefined), (error: unknown) => error === cleanupFailure);
	await ownership.discard();
	assert.strictEqual(providers.get('source'), candidate);
	assert.equal(candidateDisposals, 0);

	providers.clear();
	await assert.rejects(providers.drain(), (error: unknown) => error === cleanupFailure);
	assert.equal(candidateDisposals, 1);
});

test('post-apply currentness failure retires the consumer before its candidate', async () => {
	const currentnessFailure = new Error('application became stale');
	const events: string[] = [];
	const ownership = createPreparedProjectSources({
		prepared: new Map([[
			'source',
			Object.freeze({
				kind: 'provider' as const,
				value: Object.freeze({ dispose: () => { events.push('provider:dispose'); } }),
			}),
		]]),
		sourceBuffers: new Map(),
		sourceChunkProviders: new Map(),
		cacheSourceBuffer: () => undefined,
		throwIfAborted: () => undefined,
	});

	await assert.rejects(ownership.commit(() => {
		events.push('consumer:apply');
	}, {
		assertCurrent() { throw currentnessFailure; },
		retireApplied() { events.push('consumer:retire'); },
	}), (error: unknown) => error === currentnessFailure);
	assert.deepEqual(events, ['consumer:apply', 'consumer:retire', 'provider:dispose']);
});

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
	let resolvePromise: ((value: Value) => void) | undefined;
	const promise = new Promise<Value>((resolve) => { resolvePromise = resolve; });
	return {
		promise,
		resolve(value) {
			if (!resolvePromise) throw new Error('Deferred resolve was unavailable.');
			resolvePromise(value);
		},
	};
}

test('discarding a preparation leaves a reused published provider owned by the registry', async () => {
	let disposals = 0;
	const live = Object.freeze({ dispose() { disposals += 1; } });
	const staged = Object.freeze({ dispose() { disposals += 1; } });
	const providers = new SourceChunkProviderRegistry<string, unknown>([['reused', live]]);
	const prepared = new Map([
		['reused', Object.freeze({ kind: 'provider' as const, value: live })],
		['fresh', Object.freeze({ kind: 'provider' as const, value: staged })],
	]);
	const ownership = createPreparedProjectSources({
		prepared,
		sourceBuffers: new Map(),
		sourceChunkProviders: providers,
		cacheSourceBuffer: () => undefined,
		throwIfAborted: () => undefined,
	});
	await ownership.discard();
	// Only the never-published provider is disposed; releasing the live one would
	// cancel the read session a render is still streaming through.
	assert.equal(disposals, 1);
	assert.strictEqual(providers.get('reused'), live);
});

test('a failed commit keeps the reused published provider while disposing staged ones', async () => {
	let liveDisposals = 0;
	let stagedDisposals = 0;
	const live = Object.freeze({ dispose() { liveDisposals += 1; } });
	const staged = Object.freeze({ dispose() { stagedDisposals += 1; } });
	const providers = new SourceChunkProviderRegistry<string, unknown>([['reused', live]]);
	const prepared = new Map([
		['reused', Object.freeze({ kind: 'provider' as const, value: live })],
		['fresh', Object.freeze({ kind: 'provider' as const, value: staged })],
	]);
	const ownership = createPreparedProjectSources({
		prepared,
		sourceBuffers: new Map(),
		sourceChunkProviders: providers,
		cacheSourceBuffer: () => undefined,
		throwIfAborted: () => undefined,
	});
	const failure = new Error('apply failed');
	await assert.rejects(
		ownership.commit(() => { throw failure; }),
		(error: unknown) => error === failure,
	);
	assert.equal(liveDisposals, 0);
	assert.equal(stagedDisposals, 1);
	assert.strictEqual(providers.get('reused'), live);
});
