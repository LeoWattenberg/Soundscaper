/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';
import { MEDIA_ASSET_CHUNK_STORAGE_TYPE } from '../src/common/editor/storage/media-asset-chunk-schema.ts';

type Stage = 'root' | 'directory' | 'handle' | 'file';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
	return { promise, resolve, reject };
}

function fixture(options: Readonly<{
	failures?: Partial<Record<Stage, unknown>>;
	before?: Partial<Record<Stage, () => Promise<void>>>;
	useStorageManager?: boolean;
}> = {}) {
	const calls: string[] = [];
	const body = new File(['exact original'], 'source.png', { type: 'application/octet-stream' });
	Object.defineProperty(body, 'arrayBuffer', { value: () => { throw new Error('Whole-body reads are forbidden.'); } });
	async function enter(stage: Stage): Promise<void> {
		calls.push(stage);
		await options.before?.[stage]?.();
		if (options.failures && Object.hasOwn(options.failures, stage)) throw options.failures[stage];
	}
	const handle = {
		async getFile() { await enter('file'); return body; },
		createWritable() { throw new Error('Inspection must not create a writer.'); },
	} as unknown as FileSystemFileHandle;
	const directory = {
		async getFileHandle(name: string, requested?: FileSystemGetFileOptions) {
			assert.equal(name, 'original.blob');
			calls.push(`file-create:${String(requested?.create)}`);
			await enter('handle'); return handle;
		},
		removeEntry() { throw new Error('Inspection must not remove files.'); },
	} as unknown as FileSystemDirectoryHandle;
	const root = {
		async getDirectoryHandle(name: string, requested?: FileSystemGetDirectoryOptions) {
			assert.equal(name, 'retained-originals');
			calls.push(`directory-create:${String(requested?.create)}`);
			await enter('directory'); return directory;
		},
	} as unknown as FileSystemDirectoryHandle;
	const storageManager = {
		async getDirectory() { await enter('root'); return root; },
	} as unknown as StorageManager;
	const repository = new OpfsRepository({ preferOpfs: true, opfsDirectoryName: 'retained-originals',
		opfsRoot: options.useStorageManager ? null : root, storageManager });
	return { repository, body, calls, root, directory, handle, storageManager };
}

const stored = { storage: 'opfs', path: 'original.blob', mimeType: 'IMAGE/PNG' };

test('strict inspection opens existing paths only and preserves native Blob MIME behavior without reading bytes', async () => {
	const { repository, body, calls } = fixture({ useStorageManager: true });
	const result = await repository.inspectBinaryRecord(stored);
	assert.equal(result.status, 'present');
	if (result.status !== 'present') assert.fail('Expected a retained body.');
	assert.equal(result.body.size, body.size);
	assert.equal(result.body.type, 'image/png');
	assert.ok(result.body instanceof Blob);
	assert.deepEqual(calls, ['root', 'directory-create:false', 'directory', 'file-create:false', 'handle', 'file']);
	const unchanged = await repository.inspectBinaryRecord({ ...stored, mimeType: body.type });
	assert.equal(unchanged.status, 'present');
	if (unchanged.status === 'present') assert.equal(unchanged.body, body);
});

test('only genuine absent directory or file lookups return an absence result', async t => {
	for (const stage of ['directory', 'handle', 'file'] as const) await t.test(stage, async () => {
		const { repository, calls } = fixture({ failures: { [stage]: new DOMException('Absent', 'NotFoundError') } });
		assert.deepEqual(await repository.inspectBinaryRecord(stored),
			{ status: 'missing', reason: stage === 'directory' ? 'directory' : 'file' });
		assert.equal(calls.includes('directory-create:true'), false);
		assert.equal(calls.includes('file-create:true'), false);
	});
});

test('permission, security, I/O and getFile failures retain their exact native error identity', async t => {
	for (const stage of ['root', 'directory', 'handle', 'file'] as const) await t.test(stage, async () => {
		for (const failure of [new DOMException('Permission refused', 'NotAllowedError'),
			new DOMException('Policy refused', 'SecurityError'), new Error('Native I/O failed')]) {
			const { repository } = fixture({ useStorageManager: true, failures: { [stage]: failure } });
			await assert.rejects(repository.inspectBinaryRecord(stored), error => error === failure);
		}
	});
});

test('root acquisition NotFound and spoofed NotFound names are errors, never proof of absent files', async () => {
	const rootFailure = new DOMException('OPFS root failed', 'NotFoundError');
	await assert.rejects(fixture({ useStorageManager: true, failures: { root: rootFailure } })
		.repository.inspectBinaryRecord(stored), error => error === rootFailure);
	for (const failure of [Object.assign(new Error('Fake missing'), { name: 'NotFoundError' }),
		{ name: 'NotFoundError' }, Object.create(DOMException.prototype) as unknown]) {
		await assert.rejects(fixture({ failures: { handle: failure } }).repository.inspectBinaryRecord(stored),
			error => error === failure);
	}
	const realMissing = new DOMException('Absent', 'NotFoundError');
	Object.defineProperty(realMissing, 'name', { get() { throw new Error('Do not inspect user properties.'); } });
	assert.deepEqual(await fixture({ failures: { handle: realMissing } }).repository.inspectBinaryRecord(stored),
		{ status: 'missing', reason: 'file' });
});

test('an unavailable or disabled OPFS backend refuses inspection without reporting absence', async () => {
	for (const repository of [new OpfsRepository({ preferOpfs: false }),
		new OpfsRepository({ preferOpfs: true, storageManager: null }),
		new OpfsRepository({ preferOpfs: true, opfsRoot: {} as FileSystemDirectoryHandle })]) {
		await assert.rejects(repository.inspectBinaryRecord(stored), /unavailable/iu);
	}
	for (const path of [null, '', 'x'.repeat(513)]) {
		await assert.rejects(fixture().repository.inspectBinaryRecord({ storage: 'opfs', path }), TypeError);
	}
});

test('inspection bypasses a swallowed cached-null directory and reacquires the existing directory on every call', async () => {
	let first = true;
	const failure = new DOMException('Temporary access refusal', 'NotAllowedError');
	const { repository, calls } = fixture({ useStorageManager: true, before: { root: async () => {
		if (first) { first = false; throw failure; }
	} } });
	assert.equal(await repository.directory(), null, 'Legacy directory caching keeps its existing behavior.');
	assert.equal(await repository.directory(), null);
	assert.equal((await repository.inspectBinaryRecord(stored)).status, 'present');
	assert.equal((await repository.inspectBinaryRecord(stored)).status, 'present');
	assert.equal(calls.filter(value => value === 'directory-create:true').length, 0);
	assert.equal(calls.filter(value => value === 'directory-create:false').length, 2);
});

test('inspection also bypasses a rejected legacy directory promise without altering that cached failure', async () => {
	let first = true; const failure = new Error('Transient directory acquisition failure');
	const { repository } = fixture({ before: { directory: async () => {
		if (first) { first = false; throw failure; }
	} } });
	await assert.rejects(repository.directory(), error => error === failure);
	assert.equal((await repository.inspectBinaryRecord(stored)).status, 'present');
	await assert.rejects(repository.directory(), error => error === failure);
});

test('inspection never asks the sync worker to flatten a native read failure', async () => {
	const current = fixture({ failures: { file: new DOMException('Cannot read body', 'SecurityError') } });
	const syncWorkerClient = new Proxy({}, { get() { throw new Error('The sync worker must not be accessed.'); } });
	const repository = new OpfsRepository({ preferOpfs: true, opfsRoot: current.root,
		opfsDirectoryName: 'retained-originals', syncWorkerClient: syncWorkerClient as never });
	await assert.rejects(repository.inspectBinaryRecord(stored), { name: 'SecurityError' });
});

test('inline bodies bypass OPFS and retain MIME slicing behavior, including empty native MIME for invalid metadata', async () => {
	const repository = new OpfsRepository({ preferOpfs: false });
	const body = new Blob(['inline'], { type: 'text/plain' });
	Object.defineProperty(body, 'arrayBuffer', { value: () => { throw new Error('Do not read inline bytes.'); } });
	for (const [mimeType, expected] of [['IMAGE/PNG', 'image/png'], ['bad\nMIME', '']] as const) {
		const result = await repository.inspectBinaryRecord({ storage: 'indexeddb-blob', blob: body, mimeType });
		assert.equal(result.status, 'present');
		if (result.status === 'present') { assert.equal(result.body.type, expected); assert.equal(result.body.size, body.size); }
	}
	assert.deepEqual(await repository.inspectBinaryRecord({ storage: 'indexeddb-blob' }),
		{ status: 'missing', reason: 'inline-blob' });
	await assert.rejects(repository.inspectBinaryRecord({ storage: 'indexeddb-blob', blob: {} }), TypeError);
});

test('a chunked media record is refused before body or backend access rather than classified as absent', async () => {
	const current = fixture({ useStorageManager: true });
	const record = { storage: MEDIA_ASSET_CHUNK_STORAGE_TYPE, sourceId: 'managed-original',
		mediaChunkToken: 'retained-token', mediaChunkBytes: 4 * 1024 ** 2, mediaChunkCount: 1, size: 163 };
	await assert.rejects(current.repository.inspectBinaryRecord(record), { name: 'TypeError', message: /storage layout/iu });
	Object.defineProperty(record, 'blob', { get() { throw new Error('Do not access chunked body storage.'); } });
	Object.defineProperty(record, 'mimeType', { get() { throw new Error('Refuse storage before metadata traversal.'); } });
	await assert.rejects(current.repository.inspectBinaryRecord(record), { name: 'TypeError', message: /storage layout/iu });
	assert.deepEqual(current.calls, []);
});

test('unknown, corrupt and omitted storage modes refuse even when an inline body is supplied', async t => {
	for (const storage of ['indexeddb', 'indexeddb-chunks', 'opfs-pcm-v1', 'future-layout', '', undefined]) {
		await t.test(String(storage), async () => {
			const current = fixture({ useStorageManager: true });
			for (const record of [{ storage }, { storage, blob: new Blob(['must not be admitted']) }]) {
				await assert.rejects(current.repository.inspectBinaryRecord(record),
					{ name: 'TypeError', message: /storage layout/iu });
			}
			const record = { storage };
			Object.defineProperty(record, 'blob', { get() { throw new Error('Do not inspect unsupported bodies.'); } });
			await assert.rejects(current.repository.inspectBinaryRecord(record),
				{ name: 'TypeError', message: /storage layout/iu });
			assert.deepEqual(current.calls, []);
		});
	}
});

test('pre-cancellation avoids even inline or native backend admission and preserves the reason', async () => {
	const stop = new AbortController(); const reason = new Error('No inspection requested'); stop.abort(reason);
	const current = fixture({ useStorageManager: true });
	await assert.rejects(current.repository.inspectBinaryRecord(stored, { signal: stop.signal }), error => error === reason);
	await assert.rejects(current.repository.inspectBinaryRecord({ storage: 'indexeddb-blob', blob: new Blob() }, { signal: stop.signal }), error => error === reason);
	assert.deepEqual(current.calls, []);
});

test('cancellation joins each native await and refuses late success or absence without continuing traversal', async t => {
	for (const stage of ['root', 'directory', 'handle', 'file'] as const) await t.test(stage, async () => {
		for (const fails of [false, true]) {
			const held = deferred<void>(); const entered = deferred<void>(); const stop = new AbortController();
			const reason = new Error(`Cancelled during ${stage}`);
			const current = fixture({ useStorageManager: true, before: { [stage]: async () => {
				entered.resolve(); await held.promise;
			} } });
			const pending = current.repository.inspectBinaryRecord(stored, { signal: stop.signal });
			let settled = false; void pending.then(() => { settled = true; }, () => { settled = true; });
			await entered.promise; stop.abort(reason); await Promise.resolve();
			assert.equal(settled, false, 'Cancellation must join the underlying native operation.');
			if (fails) held.reject(new DOMException('Late absence', 'NotFoundError')); else held.resolve();
			await assert.rejects(pending, error => error === reason);
			assert.equal(current.calls.at(-1), stage, 'No subsequent file traversal after cancellation.');
		}
	});
});
