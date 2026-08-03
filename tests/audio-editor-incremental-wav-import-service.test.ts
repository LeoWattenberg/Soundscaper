/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createIncrementalWavImporter,
} from '../src/common/editor/controller/incremental-wav-import-service.ts';

class TestSourceChunkProviders extends Map<string, unknown> {
	readonly #calls: string[];
	readonly #drainOperation: () => Promise<void>;

	constructor(calls: string[], drainOperation: () => Promise<void>) {
		super();
		this.#calls = calls;
		this.#drainOperation = drainOperation;
	}

	override delete(sourceId: string): boolean {
		this.#calls.push(`delete-provider:${sourceId}`);
		return super.delete(sourceId);
	}

	async drain(): Promise<void> {
		this.#calls.push('drain-providers:start');
		await this.#drainOperation();
		this.#calls.push('drain-providers:done');
	}
}

test('incremental rollback retires its provider before deleting source storage', async () => {
	const cancellation = new DOMException('import cancelled', 'AbortError');
	const fixture = createFixture({ activationFailure: cancellation });

	await assert.rejects(fixture.importWav(), (error: unknown) => error === cancellation);
	assert.deepEqual(fixture.calls.filter((call) => (
		/delete-provider|publish-engine-providers|drain-providers|delete-source/u.test(call)
	)), [
		'delete-provider:source-1',
		'publish-engine-providers',
		'drain-providers:start',
		'drain-providers:done',
		'delete-source:source-1',
	]);
});

test('incremental rollback retains source storage when provider cleanup fails', async () => {
	const primary = new Error('activation failed');
	const cleanup = new Error('provider cleanup failed');
	const fixture = createFixture({
		activationFailure: primary,
		drainOperation: async () => { throw cleanup; },
	});

	await assert.rejects(fixture.importWav(), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [primary, cleanup]);
		assert.strictEqual(error.cause, primary);
		return true;
	});
	assert.equal(fixture.calls.includes('delete-source:source-1'), false);
});

test('incremental rollback waits for provider cleanup before source deletion', async () => {
	const primary = new Error('activation failed');
	const started = deferred();
	const gate = deferred();
	const fixture = createFixture({
		activationFailure: primary,
		drainOperation: async () => {
			started.resolve();
			await gate.promise;
		},
	});

	const pending = fixture.importWav();
	await started.promise;
	assert.equal(fixture.calls.includes('delete-source:source-1'), false);
	gate.resolve();
	await assert.rejects(pending, (error: unknown) => error === primary);
	assert.equal(fixture.calls.includes('delete-source:source-1'), true);
});

test('incremental rollback preserves source deletion failure beside its primary failure', async () => {
	const primary = new Error('commit failed');
	const cleanup = new Error('source deletion failed');
	const fixture = createFixture({ activationFailure: primary, sourceDeletionFailure: cleanup });

	await assert.rejects(fixture.importWav(), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [primary, cleanup]);
		assert.strictEqual(error.cause, primary);
		return true;
	});
});

interface FixtureOptions {
	readonly activationFailure: unknown;
	readonly drainOperation?: () => Promise<void>;
	readonly sourceDeletionFailure?: unknown;
}

function createFixture(options: FixtureOptions) {
	const calls: string[] = [];
	const sourceBuffers = new Map<string, unknown>();
	const sourceChunkProviders = new TestSourceChunkProviders(
		calls,
		options.drainOperation ?? (async () => undefined),
	);
	const sourcePeaks = new Map<string, unknown>();
	const importIncrementalWav = createIncrementalWavImporter({
		SOURCE_CHUNK_FRAMES: 2,
		async activateStoredSource(source: { id: string }) {
			calls.push(`activate:${source.id}`);
			sourceBuffers.set(source.id, {});
			sourceChunkProviders.set(source.id, {});
			sourcePeaks.set(source.id, {});
			throw options.activationFailure;
		},
		commit: () => { throw new Error('Commit must not follow failed activation.'); },
		copy: { track: 'Track' },
		createStableId: (prefix) => `${prefix}-1`,
		getProject: () => ({ tracks: [] }),
		importResultWithWarnings: (result: unknown) => result,
		preflightStorage: async () => undefined,
		prepareImportedMediaCommand: () => ({ command: {}, selection: {}, result: {} }),
		projectSampleRate: () => 48_000,
		reportProgress: () => undefined,
		retireSourceChunkProvider: async (sourceId) => {
			sourceChunkProviders.delete(sourceId);
			calls.push('publish-engine-providers');
			await sourceChunkProviders.drain();
		},
		sourceBuffers,
		sourcePcmBytes: () => 8,
		sourcePeaks,
		store: {
			async beginSourceWrite() {
				return {
					abort: async () => undefined,
					commit: async () => ({ chunkCount: 1 }),
					write: async () => undefined,
				};
			},
			async deleteSource(sourceId) {
				calls.push(`delete-source:${sourceId}`);
				if (options.sourceDeletionFailure) throw options.sourceDeletionFailure;
			},
		},
		streamWavBlobPcm: async (_file: unknown, streamOptions: {
			onChunk(channels: Float32Array[]): Promise<void>;
		}) => streamOptions.onChunk([Float32Array.of(0, 0)]),
		stripExtension: (name) => name.replace(/\.wav$/u, ''),
		warnEnvelope: () => undefined,
	});
	return {
		calls,
		importWav: () => importIncrementalWav(
			{ name: 'source.wav', type: 'audio/wav' },
			{ channelCount: 1, frameCount: 2, sampleRate: 48_000 },
			{},
			{},
		),
	};
}

function deferred() {
	let resolvePromise: () => void = () => undefined;
	const promise = new Promise<void>((resolve) => { resolvePromise = resolve; });
	return { promise, resolve: resolvePromise };
}
