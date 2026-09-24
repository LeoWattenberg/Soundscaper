/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createPreparedProjectSources } from '../src/common/editor/controller/source/internal/prepared-project-sources.ts';
import { SourceChunkProviderRegistry } from '../src/common/editor/controller/source/source-chunk-provider-registry.ts';

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

test('commit applies transient buffers and publishes prepared source ownership together', async () => {
	const sourceBuffers = new Map([['old', 'old buffer']]);
	const providers = new Map([['replaced', 'old provider']]);
	const cached: Array<readonly [string, string]> = [];
	const ownership = createPreparedProjectSources({
		prepared: new Map([
			['replaced', { kind: 'buffer' as const, value: 'new buffer' }],
			['new', { kind: 'provider' as const, value: 'new provider' }],
		]),
		sourceBuffers,
		sourceChunkProviders: providers,
		cacheSourceBuffer: (id, value) => { cached.push([id, value]); },
		throwIfAborted: () => undefined,
	});

	const result = await ownership.commit((inputs) => {
		assert.deepEqual([...inputs.sourceBuffers], [
			['old', 'old buffer'],
			['temporary', 'temporary buffer'],
			['replaced', 'new buffer'],
		]);
		assert.deepEqual([...inputs.chunkSources], [['new', 'new provider']]);
		assert.equal(providers.get('replaced'), 'old provider', 'publication waits for apply');
		return 'applied';
	}, { transientBuffers: new Map([['temporary', 'temporary buffer']]) });

	assert.equal(result, 'applied');
	assert.deepEqual(cached, [['replaced', 'new buffer']]);
	assert.deepEqual([...providers], [['new', 'new provider']]);
	await assert.rejects(ownership.commit(() => undefined), /already committed/u);
});

test('failed application reports retirement and provider cleanup failures together', async () => {
	const applicationFailure = new Error('apply failed');
	const retirementFailure = new Error('retire failed');
	const cleanupFailure = new Error('dispose failed');
	const ownership = createPreparedProjectSources({
		prepared: new Map([[
			'source',
			{ kind: 'provider' as const, value: { dispose: () => { throw cleanupFailure; } } },
		]]),
		sourceBuffers: new Map(),
		sourceChunkProviders: new Map(),
		cacheSourceBuffer: () => undefined,
		throwIfAborted: () => undefined,
	});

	await assert.rejects(ownership.commit(() => { throw applicationFailure; }, {
		retireApplied: () => { throw retirementFailure; },
	}), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.equal(error.cause, cleanupFailure);
		assert.equal(error.errors[1], cleanupFailure);
		assert.ok(error.errors[0] instanceof AggregateError);
		assert.deepEqual(error.errors[0].errors, [applicationFailure, retirementFailure]);
		return true;
	});
	await assert.rejects(async () => ownership.discard(), (error: unknown) => error === cleanupFailure);
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
