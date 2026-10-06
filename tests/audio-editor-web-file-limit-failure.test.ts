/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createLocalizedError } from '../src/common/i18n/presentation-message.ts';
import {
	BrowserFileStorageError,
	browserFileStorageFailure,
	isWebFileLimitFailure,
	WebFileLoadLimitError,
	withWebFileLoadLimitContext,
} from '../src/common/editor/web-file-limit-failure.ts';
import { aup4PoolImportFailure } from '../src/common/editor/aup4-worker-values.js';
import { prepareMediaAssetStaging } from '../src/common/editor/storage/media-asset-staged-sink.ts';
import { MediaRepository } from '../src/common/editor/storage/media-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { SourceWriteRepository } from '../src/common/editor/storage/source-write-repository.ts';

test('web file-limit failures include quota, bounded imports, and nested OPFS writes', () => {
	assert.equal(isWebFileLimitFailure({ code: 'PROJECT_TOO_LARGE' }), true);
	assert.equal(isWebFileLimitFailure({ code: 'QUOTA_EXCEEDED' }), true);
	assert.equal(isWebFileLimitFailure(new DOMException('Disk full', 'QuotaExceededError')), true);
	assert.equal(isWebFileLimitFailure(new RangeError('Raw PCM input exceeds the size limit.')), true);
	assert.equal(isWebFileLimitFailure(new RangeError('The compressed audio original exceeds the 1 GB import limit.')), true);
	assert.equal(isWebFileLimitFailure(new RangeError('DAWproject media sample.wav exceeds the import working memory budget.')), true);
	assert.equal(isWebFileLimitFailure(createLocalizedError(Error,
		{ insufficientStorage: 'Not enough storage for {operation}' },
		'insufficientStorage', { operation: 'import' })), true);
	assert.equal(isWebFileLimitFailure(new AggregateError([
		new Error('Cleanup failed'), new BrowserFileStorageError('OPFS source write', new Error('disk refused')),
	], 'Import and cleanup failed')), true);
});

test('invalid files and cancelled operations do not suggest desktop', () => {
	assert.equal(isWebFileLimitFailure(new Error('Invalid AUP4 database')), false);
	assert.equal(isWebFileLimitFailure(new RangeError('Invalid channel count')), false);
	assert.equal(isWebFileLimitFailure(new RangeError('A Scape metadata record exceeds the portable byte limit.')), false);
	assert.equal(isWebFileLimitFailure(new RangeError('The Scape archive exceeds the declared expansion limit.')), false);
	assert.equal(isWebFileLimitFailure({ code: 'ABORTED' }), false);
	assert.equal(isWebFileLimitFailure(new DOMException('Cancelled', 'AbortError')), false);
	const cancelled = new DOMException('Cancelled', 'AbortError');
	assert.equal(browserFileStorageFailure('OPFS source admission', cancelled), cancelled);
});

test('only an explicit file-load boundary marks a capacity failure for the prompt', async () => {
	const quota = new DOMException('Disk full', 'QuotaExceededError');
	await assert.rejects(withWebFileLoadLimitContext(() => { throw quota; }),
		(error: unknown) => error instanceof WebFileLoadLimitError && error.cause === quota);
	const corrupt = new Error('Invalid AUP4 database');
	await assert.rejects(withWebFileLoadLimitContext(() => { throw corrupt; }), corrupt);
	assert.equal(isWebFileLimitFailure(quota), true);
	assert.equal(quota instanceof WebFileLoadLimitError, false);
});

test('a large AUP4 whose OPFS import fails reports the browser memory limit', () => {
	const opfsFailure = new Error('OPFS write refused');
	const largeFailure = aup4PoolImportFailure(opfsFailure, { size: 300, memoryLimit: 200 });
	assert.equal(largeFailure.code, 'PROJECT_TOO_LARGE');
	assert.equal(largeFailure.details?.size, 300);
	assert.equal(largeFailure.details?.limit, 200);
	assert.equal(aup4PoolImportFailure(opfsFailure, { size: 100, memoryLimit: 200 }), opfsFailure);
	const aborted = new Error('Cancelled');
	aborted.name = 'AbortError';
	assert.equal(aup4PoolImportFailure(aborted, { size: 300, memoryLimit: 200 }), aborted);
});

test('an OPFS audio source admission error keeps its cause for the load boundary', async () => {
	const failure = new Error('OPFS file creation failed');
	const repository = new SourceWriteRepository({
		database: async () => null,
		deleteStoredSource: async () => undefined,
		opfs: { createPcmWriter: async () => { throw failure; } } as never,
		pcm: {} as never,
		records: {} as never,
		staging: {} as never,
	});
	await assert.rejects(repository.begin('source'), (error: unknown) =>
		error instanceof BrowserFileStorageError && error.cause === failure);
});

test('a failed source staging admission retains both its primary failure and OPFS rollback failure', async (context) => {
	for (const primary of [new Error('Source staging admission failed'), new DOMException('Cancelled', 'AbortError')]) {
		await context.test(primary.name, async () => {
			const cleanup = new AggregateError([new Error('OPFS close failed'), new Error('OPFS remove failed')], 'OPFS rollback failed');
			const events: string[] = [];
			const repository = new SourceWriteRepository({
				database: async () => null,
				deleteStoredSource: async () => undefined,
				opfs: { createPcmWriter: async () => ({ path: 'pcm-stage', abort: async () => {
					events.push('abort');
					throw cleanup;
				} }) } as never,
				pcm: {} as never,
				records: { put: async () => { events.push('publish'); } } as never,
				staging: { acquire: async () => { events.push('admit'); throw primary; } } as never,
			});
			await assert.rejects(repository.begin('source'), (error: unknown) => {
				assert.ok(error instanceof AggregateError);
				assert.equal(error.cause, primary);
				assert.deepEqual(error.errors, [primary, cleanup]);
				assert.equal(error.name, primary.name === 'AbortError' ? 'AbortError' : 'AggregateError');
				return true;
			});
			assert.deepEqual(events, ['admit', 'abort']);
		});
	}
});

test('successful OPFS rollback preserves the original source admission failure identity', async () => {
	const primary = new Error('Source staging admission failed');
	let aborted = 0;
	const repository = new SourceWriteRepository({
		database: async () => null,
		deleteStoredSource: async () => undefined,
		opfs: { createPcmWriter: async () => ({ path: 'pcm-stage', abort: async () => { aborted += 1; } }) } as never,
		pcm: {} as never,
		records: {} as never,
		staging: { acquire: async () => { throw primary; } } as never,
	});
	await assert.rejects(repository.begin('source'), (error: unknown) => error === primary);
	assert.equal(aborted, 1);
});

test('an OPFS media admission error releases its lease and keeps its cause', async () => {
	const failure = new Error('OPFS media file creation failed');
	let released = false;
	await assert.rejects(prepareMediaAssetStaging({
		sourceId: 'media', expectedBytes: 100, maximumMemoryBytes: 10,
		database: {} as IDBDatabase, chunks: {} as never,
		staging: { acquire: async () => ({ release: async () => { released = true; } }) } as never,
		opfs: { planBinaryWriter: async () => ({ path: 'media', open: async () => { throw failure; } }) } as never,
	}), (error: unknown) => error instanceof BrowserFileStorageError && error.cause === failure);
	assert.equal(released, true);
});

test('an OPFS media plan rejection is identified before a lease is acquired', async () => {
	const failure = new Error('OPFS plan unavailable');
	let acquired = false;
	await assert.rejects(prepareMediaAssetStaging({
		sourceId: 'media', expectedBytes: 100, maximumMemoryBytes: 10,
		database: {} as IDBDatabase, chunks: {} as never,
		staging: { acquire: async () => { acquired = true; } } as never,
		opfs: { planBinaryWriter: async () => { throw failure; } } as never,
	}), (error: unknown) => error instanceof BrowserFileStorageError && error.cause === failure);
	assert.equal(acquired, false);
});

test('a direct media OPFS write rejection is identified after rollback', async () => {
	const failure = new Error('OPFS write refused');
	const media = new MediaRepository(
		{ memory: getMemoryDatabase('web-file-limit-direct-media-write'), database: async () => null },
		{ writeBlob: async () => { throw failure; } } as never,
	);
	await assert.rejects(media.writeAsset('source', new Blob(['media'])),
		(error: unknown) => error instanceof BrowserFileStorageError && error.cause === failure);
});
