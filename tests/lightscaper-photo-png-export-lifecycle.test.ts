/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { PhotoPngExportV1, type PhotoPngExportRequestV1 } from '../src/lightscaper/controller/photo-png-export-v1.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createFileSystemPreparedSave } from '../src/common/editor/file-save-stream.ts';
import type { PreparedDirectSave } from '../src/common/editor/file-save-stream.ts';
import { createBrowserFileSaveService } from '../src/common/editor/browser-file-save-service.ts';
import { createPhotoLibraryDevelopOriginalSessionV2 } from '../src/lightscaper/controller/photo-library-develop-original-session-v2.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { withPhotoOriginalFrameV1 } from '../src/lightscaper/preview/photo-original-frame-v1.ts';
import { PhotoCatalogRevisionConflictError } from '../src/lightscaper/catalog/repository-types.ts';
import type { PhotoLibraryDevelopSnapshotV2 } from '../src/common/editor/photo-library-develop-port-v2.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { deferred, remainsPending, waitForEvent } from './helpers/async-test-control.ts';
import { queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';

const PNG = [137, 80, 78, 71, 1, 3, 5, 7];
function frame(): PixelFrameV1 {
	return { descriptor: { schemaVersion: 1, width: 2, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' },
		pixels: new Uint8Array([9, 31, 57, 255, 80, 100, 120, 255]) };
}
function fixture() {
	const owner = new PhotoPngExportV1(), events: string[] = [], source = frame(), writes: number[][] = [];
	let revision = 3, current = true, encoded: Uint8Array<ArrayBuffer> | null = null;
	const snapshot = (): PhotoLibraryDevelopSnapshotV2 => ({ schemaVersion: 2, catalogId: 'catalog-1', photoId: 'photo-1', revision,
		activeVersionId: 'master', versionId: 'master', versions: [{ id: 'master', name: 'Master', kind: 'master' }],
		develop: defaultImageDevelopStateV2(), history: { cursor: 0, entries: [] }, snapshots: [] });
	const input: PhotoPngExportRequestV1 = {
		photoId: 'photo-1', versionId: 'master', expectedRevision: 3, fileName: 'Summer.png', fileTypeDescription: 'PNG image',
		prepareSave: request => {
			events.push('picker'); assert.equal(request.purpose, 'media'); assert.equal(request.mimeType, 'image/png');
			assert.equal(request.suggestedName, 'Summer.png'); assert.equal(request.useFileSystemAccess, true);
			assert.deepEqual(request.types, [{ description: 'PNG image', accept: { 'image/png': ['.png'] } }]);
			return createFileSystemPreparedSave({ fileName: 'Summer.png', signal: request.signal, target: { createWritable: () => {
				events.push('open'); return Promise.resolve({ write: value => {
					assert.ok(value instanceof Uint8Array); events.push('write'); writes.push(Array.from(value));
				}, close: () => { events.push('commit'); }, abort: () => { events.push('abort'); } });
			} } });
		},
		saveFile: async () => { assert.fail('Native staging must not use Blob delivery.'); },
		execute: async (action, signal) => {
			events.push('execute'); assert.ok(signal); await action({ signal, acquire: async () => ({ schemaVersion: 2,
				read: async request => { events.push('read'); assert.equal(request.versionId, 'master'); return snapshot(); },
				apply: async () => { assert.fail('Export never edits the photo.'); } }), isCurrent: () => current, refresh: async () => undefined });
		},
		withOriginalFrame: async (request, consume, options) => {
			events.push('original'); assert.deepEqual(request, { schemaVersion: 1, photoId: 'photo-1', expectedRevision: 3 });
			assert.ok(options?.signal); const result = await consume({ photoId: 'photo-1', revision, frame: source });
			events.push('original-settled'); return result;
		},
		loadRenderer: async () => createPhotoDevelopRenderRuntimeV2(),
		encode: async (output, options) => {
			events.push('encode'); assert.notEqual(output.pixels.buffer, source.pixels.buffer);
			assert.deepEqual(Array.from(output.pixels), Array.from(source.pixels)); assert.equal(options.maximumOutputBytes, 268_435_456);
			encoded = new Uint8Array(PNG); return encoded;
		},
	};
	return { owner, input, events, writes, source, encoded: () => encoded,
		setRevision: (value: number) => { revision = value; }, setCurrent: (value: boolean) => { current = value; } };
}

test('the original Save gesture prepares its destination and commits exact independent PNG bytes after both frame scopes', async () => {
	const f = fixture(), work = f.owner.start(f.input); void work.catch(() => undefined);
	assert.deepEqual(f.events, ['picker']); assert.equal(f.owner.isPending(), true);
	const receipt = await work;
	assert.deepEqual(f.writes, [PNG]); assert.ok(f.events.indexOf('open') > f.events.indexOf('original-settled'));
	assert.deepEqual(receipt, { status: 'saved', photoId: 'photo-1', versionId: 'master', revision: 3,
		width: 2, height: 1, byteLength: PNG.length, fileName: 'Summer.png', method: 'file-system-access' });
	assert.equal('frame' in receipt, false); assert.equal('bytes' in receipt, false); assert.equal(Object.isFrozen(receipt), true);
	assert.deepEqual(Array.from(f.encoded()!), PNG.map(() => 0)); assert.deepEqual(Array.from(f.source.pixels), [9, 31, 57, 255, 80, 100, 120, 255]);
	assert.equal(f.owner.isPending(), false);
});

test('held encoding and independently held original final settlement suppress every write and publication', async () => {
	const f = fixture(), encode = deferred<void>(), close = deferred<void>(), actualEncode = f.input.encode, original = f.input.withOriginalFrame;
	const work = f.owner.start({ ...f.input, encode: async (...args) => { f.events.push('encode-held'); await encode.promise; return actualEncode(...args); },
		withOriginalFrame: async (...args) => { const result = await original(...args); f.events.push('original-close-held'); await close.promise; return result; } });
	await waitForEvent(f.events, 'encode-held'); assert.equal(await remainsPending(work), true); assert.equal(f.events.includes('open'), false);
	encode.resolve(); await waitForEvent(f.events, 'original-close-held'); assert.equal(await remainsPending(work), true);
	assert.equal(f.events.includes('open'), false); assert.deepEqual(Array.from(f.encoded()!), PNG);
	close.resolve(); assert.equal((await work).status, 'saved'); assert.deepEqual(Array.from(f.encoded()!), PNG.map(() => 0));
});

test('late renderer failure and late original cleanup failure suppress native staging and wipe independent output', async () => {
	for (const lateOwner of ['render', 'original'] as const) {
		const f = fixture(), failure = new Error(`${lateOwner} settlement failed`), actual = createPhotoDevelopRenderRuntimeV2();
		const input: PhotoPngExportRequestV1 = { ...f.input, loadRenderer: async () => ({ withFullResolution: async (...args) => {
			const result = await actual.withFullResolution(...args); if (lateOwner === 'render') throw failure; return result;
		} }), withOriginalFrame: async (...args) => {
			const result = await f.input.withOriginalFrame(...args); if (lateOwner === 'original') throw failure; return result;
		} };
		await assert.rejects(f.owner.start(input), (error: unknown) => error === failure);
		assert.equal(f.events.includes('open'), false); assert.deepEqual(Array.from(f.encoded()!), PNG.map(() => 0));
	}
});

test('the actual original owner revalidates after encoding, refuses a late Photo2 revision and wipes its pixels', async () => {
	const f = fixture(), png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
	const source = queryPhotoV1();
	let photo = normalizePhotoDocumentV2({ ...source, id: 'photo-1', catalogId: 'catalog', revision: 3, schemaVersion: 2,
		original: { ...source.original, width: 1, height: 1, mimeType: 'image/png', byteLength: png.length,
			contentSha256: createHash('sha256').update(png).digest('hex') },
		versions: source.versions.map(version => ({ ...version, develop: defaultImageDevelopStateV2() })) });
	const borrowed: PixelFrameV1[] = [], encoded = new Uint8Array(PNG);
	const original = createPhotoLibraryDevelopOriginalSessionV2({ repository: { loadPhoto: async () => photo }, ready: async () => 'catalog',
		operation: async (run, signal) => { assert.ok(signal); return run(signal); }, loadOriginal: async () => new Blob([png]),
		withFrame: (request, consume) => withPhotoOriginalFrameV1(request, consume, { openImage: async () => ({
			metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'export-test' },
			decodeFrame: async () => ({ rgba: Uint8Array.of(7, 19, 233, 255), durationMicroseconds: null }), close() {},
		}) }),
	});
	await assert.rejects(f.owner.start({ ...f.input, withOriginalFrame: (request, consume, options) => original.withFrame(request, view => {
		borrowed.push(view.frame); return consume(view);
	}, options), encode: async output => {
		assert.deepEqual(Array.from(output.pixels), [7, 19, 233, 255]); photo = normalizePhotoDocumentV2({ ...photo, revision: 4 }); return encoded;
	} }), PhotoCatalogRevisionConflictError);
	assert.equal(f.events.includes('open'), false); assert.equal(borrowed[0]!.pixels.every(value => value === 0), true);
	assert.equal(encoded.every(value => value === 0), true); assert.deepEqual(new Uint8Array(await new Blob([png]).arrayBuffer()), png);
});

test('revision and generation changes after original settlement or after staging refuse commit', async () => {
	for (const change of ['revision', 'generation'] as const) {
		for (const duringWrite of [false, true]) {
			const f = fixture(), modify = () => { if (change === 'revision') f.setRevision(4); else f.setCurrent(false); };
			const prepareSave: PhotoPngExportRequestV1['prepareSave'] = request => createFileSystemPreparedSave({ fileName: 'Summer.png', signal: request.signal,
				target: { createWritable: () => { f.events.push('open'); return Promise.resolve({
					write: () => { modify(); }, close: () => { f.events.push('commit'); }, abort: () => { f.events.push('abort'); },
				}); } } });
			await assert.rejects(f.owner.start({ ...f.input, ...(duringWrite ? { prepareSave } : {}), withOriginalFrame: async (...args) => {
				const result = await f.input.withOriginalFrame(...args); if (!duringWrite) modify(); return result;
			} }), /revision|stale/iu);
			assert.equal(f.events.includes('commit'), false); if (duringWrite) assert.equal(f.events.includes('abort'), true);
			assert.equal(f.encoded()!.every(value => value === 0), true);
		}
	}
});

test('cancellation joins held original read and late cleanup without opening a writer or reflecting the reason', async () => {
	const f = fixture(), entered = deferred<void>(), read = deferred<void>(), cleanup = deferred<void>();
	const reason = new Proxy({}, { get() { assert.fail('Opaque reason read'); }, getPrototypeOf() { assert.fail('Opaque reason reflected'); } });
	const work = f.owner.start({ ...f.input, withOriginalFrame: async (...args) => {
		entered.resolve(); await read.promise;
		try { return await f.input.withOriginalFrame(...args); }
		finally { f.events.push('read-cleanup'); await cleanup.promise; }
	} });
	const outcome = work.then(() => ({ failure: null }), (failure: unknown) => ({ failure })); await entered.promise;
	const joining = f.owner.cancelAndJoin(reason); assert.equal(await remainsPending(joining), true);
	await assert.rejects(f.owner.start(f.input), /pending/iu); read.resolve();
	// The borrowed original callback sees cancellation; its own cleanup must still settle.
	await waitForEvent(f.events, 'read-cleanup'); assert.equal(await remainsPending(joining), true);
	cleanup.resolve(); await joining; assert.equal((await outcome).failure === reason, true); assert.equal(f.events.includes('open'), false);
	assert.equal(f.owner.isPending(), false);
});

test('cancellation during held encode joins render and original cleanup and wipes PNG before retirement resolves', async () => {
	const f = fixture(), encode = deferred<void>(), close = deferred<void>(), reason = new Error('retired'), actual = f.input.encode;
	const work = f.owner.start({ ...f.input, encode: async (...args) => { f.events.push('encode-held'); await encode.promise; return actual(...args); },
		withOriginalFrame: async (...args) => {
			try { return await f.input.withOriginalFrame(...args); }
			finally { f.events.push('cleanup-held'); await close.promise; }
		} });
	const outcome = work.catch((value: unknown) => value); await waitForEvent(f.events, 'encode-held');
	const joining = f.owner.cancelAndJoin(reason); encode.resolve(); await waitForEvent(f.events, 'cleanup-held');
	assert.equal(await remainsPending(joining), true); assert.deepEqual(Array.from(f.encoded()!), PNG);
	close.resolve(); await joining; assert.equal(await outcome, reason); assert.equal(f.encoded()!.every(value => value === 0), true);
	assert.equal(f.events.includes('open'), false);
});

test('late native open and held abort remain owned until cancellation cleanup finishes', async () => {
	const f = fixture(), open = deferred<void>(), abort = deferred<void>(), reason = new Error('retired');
	const work = f.owner.start({ ...f.input, prepareSave: request => createFileSystemPreparedSave({ fileName: 'Summer.png', signal: request.signal,
		target: { createWritable: async () => { f.events.push('open-held'); await open.promise; return {
			write() { assert.fail('Cancelled late-open writer used'); }, close() { assert.fail('Cancelled writer committed'); },
			abort: async value => { assert.equal(value, reason); f.events.push('abort-held'); await abort.promise; },
		}; } } }) });
	const outcome = work.catch((value: unknown) => value); await waitForEvent(f.events, 'open-held');
	const joining = f.owner.cancelAndJoin(reason); assert.equal(await remainsPending(joining), true);
	open.resolve(); await waitForEvent(f.events, 'abort-held'); assert.equal(await remainsPending(joining), true);
	assert.deepEqual(Array.from(f.encoded()!), PNG); abort.resolve(); await joining;
	assert.equal(await outcome, reason); assert.equal(f.encoded()!.every(value => value === 0), true);
});

test('a held native write retains its borrowed PNG view until write and abort drain before buffer wipe', async () => {
	const f = fixture(), write = deferred<void>(), abort = deferred<void>(), reason = new Error('retired'), generation = new AbortController();
	let held: Uint8Array | null = null;
	const work = f.owner.start({ ...f.input, execute: (action, signal) => f.input.execute(context => action({ ...context,
		signal: AbortSignal.any([context.signal, generation.signal]) }), signal),
		prepareSave: request => createFileSystemPreparedSave({ fileName: 'Summer.png', signal: request.signal,
		target: { createWritable: async () => ({ write: async value => {
			assert.ok(value instanceof Uint8Array); held = value; f.events.push('write-held'); await write.promise;
			assert.deepEqual(Array.from(value), PNG);
		}, close() { assert.fail('Cancelled write committed'); }, abort: async () => { f.events.push('abort-held'); await abort.promise; } }) } }) });
	const outcome = work.catch((value: unknown) => value); await waitForEvent(f.events, 'write-held');
	generation.abort(reason); const joining = f.owner.cancelAndJoin(reason); await waitForEvent(f.events, 'abort-held');
	assert.equal(await remainsPending(joining), true); assert.deepEqual(Array.from(f.encoded()!), PNG);
	abort.resolve(); assert.equal(await remainsPending(joining), true); write.resolve(); await joining;
	assert.equal(await outcome, reason); assert.equal(f.encoded()!.every(value => value === 0), true);
	assert.ok(held); assert.equal((held as Uint8Array).every(value => value === 0), true);
});

test('late cancellation during held native commit joins its ACK and keeps bytes until the destination settles', async () => {
	const f = fixture(), commit = deferred<void>(), lifetime = new AbortController();
	const work = f.owner.start({ ...f.input, signal: lifetime.signal, execute: (action, signal) => f.input.execute(context => action({ ...context,
		signal: AbortSignal.any([context.signal, lifetime.signal]) }), signal),
		prepareSave: request => createFileSystemPreparedSave({ fileName: 'Summer.png', signal: request.signal,
		target: { createWritable: async () => ({ write: value => { assert.ok(value instanceof Uint8Array); f.writes.push(Array.from(value)); },
			close: async () => { f.events.push('commit-held'); await commit.promise; }, abort() { assert.fail('Committed destination aborted'); } }) } }) });
	await waitForEvent(f.events, 'commit-held'); lifetime.abort(new Error('late external cancellation'));
	const joining = f.owner.cancelAndJoin(); assert.equal(await remainsPending(joining), true);
	await assert.rejects(f.owner.start(f.input), /pending/iu); assert.deepEqual(Array.from(f.encoded()!), PNG);
	commit.resolve(); assert.equal((await work).status, 'saved'); await joining;
	assert.deepEqual(f.writes, [PNG]); assert.equal(f.encoded()!.every(value => value === 0), true);
});

test('failed native commit joins held cleanup and preserves distinct opaque primary/cleanup identities', async () => {
	const f = fixture(), cleanup = deferred<void>();
	const primary = new Proxy({}, { get() { assert.fail('Primary read'); } }), secondary = new Proxy({}, { get() { assert.fail('Cleanup read'); } });
	const work = f.owner.start({ ...f.input, prepareSave: request => createFileSystemPreparedSave({ fileName: 'Summer.png', signal: request.signal,
		target: { createWritable: async () => ({ write() {}, close() { throw primary; }, abort: async () => {
			f.events.push('abort-held'); await cleanup.promise; throw secondary;
		} }) } }) });
	const outcome = work.catch((value: unknown) => value); await waitForEvent(f.events, 'abort-held');
	const joining = f.owner.cancelAndJoin(); assert.equal(await remainsPending(joining), true);
	assert.deepEqual(Array.from(f.encoded()!), PNG); cleanup.resolve(); const error = await outcome;
	assert.ok(error instanceof AggregateError); assert.equal(error.errors[0] === primary, true); assert.equal(error.errors[1] === secondary, true);
	assert.equal(error.cause === primary, true); await joining; assert.equal(f.encoded()!.every(value => value === 0), true);
});

test('workflow swallowing failure, including thrown undefined, cannot turn a failed frame into delivery', async () => {
	for (const failure of [undefined, new Error('original failed')]) {
		const f = fixture(), execute = f.input.execute;
		await assert.rejects(f.owner.start({ ...f.input, withOriginalFrame: async () => { throw failure; },
			execute: async (...args) => { try { return await execute(...args); } catch { return 'failed'; } } }), (error: unknown) => error === failure);
		assert.equal(f.events.includes('open'), false); assert.equal(f.owner.isPending(), false);
	}
	const f = fixture(); await assert.rejects(f.owner.start({ ...f.input, execute: async () => 'busy' }), /did not execute/iu);
	assert.equal(f.events.includes('original'), false);
});

test('late picker cancellation joins captured destination cleanup and dismissal never acquires a photo', async () => {
	const f = fixture(), picker = deferred<PreparedDirectSave>(), cleanup = deferred<void>(), reason = new Error('retired');
	const direct = createFileSystemPreparedSave({ fileName: 'Summer.png', target: { createWritable: async () => { assert.fail('Late picker opened'); } } });
	const work = f.owner.start({ ...f.input, prepareSave: () => picker.promise }); const outcome = work.catch((value: unknown) => value);
	const joining = f.owner.cancelAndJoin(reason); assert.equal(await remainsPending(joining), true);
	const prepared = { ...direct, abort: async function (value: unknown) { assert.equal(this, prepared); assert.equal(value, reason); f.events.push('abort-held'); await cleanup.promise; } };
	picker.resolve(prepared); await waitForEvent(f.events, 'abort-held'); assert.equal(await remainsPending(joining), true);
	cleanup.resolve(); await joining; assert.equal(await outcome, reason); assert.equal(f.events.includes('execute'), false);
	assert.deepEqual(await f.owner.start({ ...f.input, prepareSave: () => ({ mode: 'cancelled', cancelled: true, fileName: 'Summer.png' }) }), { status: 'cancelled' });
	assert.equal(f.events.includes('execute'), false);
});

test('actual browser download reuses the gesture target and copies PNG after joined scopes, before owner wipe', async () => {
	const f = fixture(), close = deferred<void>(), rendered = deferred<void>();
	let blob: Blob | null = null, click = 0, picks = 0, timer: (() => void) | undefined;
	const anchor = { href: '', download: '', hidden: false, click() { click++; }, remove() {} };
	const service = createBrowserFileSaveService({ scope: { showSaveFilePicker() { picks++; return Promise.resolve({ browserDownload: true }); } },
		document: { createElement: () => anchor, body: { append() {} } }, urlApi: {
			createObjectURL(value) { blob = value; return 'blob:png'; }, revokeObjectURL() {},
		}, setTimeout(callback) { timer = callback; } });
	const work = f.owner.start({ ...f.input, prepareSave: service.prepareSave, saveFile: service.saveFile, withOriginalFrame: async (...args) => {
		const result = await f.input.withOriginalFrame(...args); rendered.resolve(); await close.promise; return result;
	} });
	assert.equal(picks, 1); await rendered.promise; assert.equal(click, 0); assert.equal(blob, null);
	close.resolve(); assert.equal((await work).status, 'download-started'); assert.equal(click, 1); assert.equal(picks, 1);
	assert.ok(blob); assert.deepEqual(Array.from(new Uint8Array(await (blob as Blob).arrayBuffer())), PNG);
	assert.equal(f.encoded()!.every(value => value === 0), true); assert.equal(anchor.download, 'Summer.png'); assert.ok(timer); timer();
});

test('captured request and renderer receivers survive asynchronous replacement without retaining a frame', async () => {
	const f = fixture(), load = deferred<void>(), actual = createPhotoDevelopRenderRuntimeV2();
	const runtime = { withFullResolution: function <Result>(...args: Parameters<typeof actual.withFullResolution<Result>>) {
		assert.equal(this, runtime); return actual.withFullResolution(...args);
	} };
	const input = { ...f.input, loadRenderer: async function () { assert.equal(this, input); f.events.push('load-held'); await load.promise; return runtime; } };
	const work = f.owner.start(input); await waitForEvent(f.events, 'load-held');
	input.photoId = 'other'; input.versionId = 'other'; input.expectedRevision = 100;
	input.encode = async () => { assert.fail('Captured encoder replaced'); };
	load.resolve(); assert.equal((await work).status, 'saved');
});

test('closed request/accessor/native cancellation admission refuses before the gesture picker', async () => {
	const f = fixture(), signal = AbortSignal.abort(new Error('pre-aborted'));
	await assert.rejects(f.owner.start({ ...f.input, signal }), /pre-aborted/iu);
	let reads = 0; const value = { ...f.input }; Object.defineProperty(value, 'photoId', { get() { reads++; return 'photo-1'; } });
	await assert.rejects(f.owner.start(value), /own|data|accessor/iu); assert.equal(reads, 0);
	await assert.rejects(f.owner.start({ ...f.input, unexpected: true } as PhotoPngExportRequestV1));
	assert.deepEqual(f.events, []);
});

test('borrowed or empty encoder output is refused without wiping original pixels or acknowledging delivery', async () => {
	for (const sourceAlias of [true, false]) {
		const f = fixture();
		await assert.rejects(f.owner.start({ ...f.input, encode: async () => sourceAlias ? f.source.pixels as Uint8Array<ArrayBuffer> : new Uint8Array() }), /independent|bound/iu);
		assert.equal(f.events.includes('open'), false); assert.deepEqual(Array.from(f.source.pixels), [9, 31, 57, 255, 80, 100, 120, 255]);
	}
});
