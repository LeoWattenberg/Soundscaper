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
	await providers.drain();
	assert.equal(candidateDisposals, 1);
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
