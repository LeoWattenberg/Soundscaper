/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryBackupSaveV1, type PhotoLibraryBackupSaveRequestV1 } from '../src/common/editor/controller/shared/photo-library-backup-save-v1.ts';
import { createFileSystemPreparedSave, type PreparedDirectSave } from '../src/common/editor/file-save-stream.ts';
import type { PhotoLibraryBackupResultV1 } from '../src/common/editor/photo-library-backup-port-v1.ts';
import { SCAPE_MIME_TYPE } from '../src/common/editor/scape-project-format.ts';
import { exportPhotoCatalogArchiveV1, maximumPhotoCatalogStreamingOutputBytesV1 } from '../src/lightscaper/archive/catalog-archive-export.ts';
import { importPhotoCatalogArchiveV1 } from '../src/lightscaper/archive/catalog-archive-import.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { deferred, remainsPending, waitForEvent } from './helpers/async-test-control.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

const BYTES = new Uint8Array([1, 3, 5, 7]);
function result(blob: Blob | null = null): PhotoLibraryBackupResultV1 {
	return { catalogId: 'catalog-1', catalogName: 'Summer', photoCount: 3, byteLength: BYTES.length, notices: [], blob };
}

function fixture() {
	const controller = new PhotoLibraryBackupSaveV1(), events: string[] = [];
	const writes: Uint8Array[] = [];
	const prepareDirect = (signal?: AbortSignal) => createFileSystemPreparedSave({ fileName: 'Summer.liscape', signal,
		target: { createWritable: () => {
			events.push('open');
			return Promise.resolve({ write: (value) => { assert.ok(value instanceof Uint8Array); writes.push(new Uint8Array(value)); },
				close: () => { events.push('commit'); }, abort: () => { events.push('abort'); } });
		} } });
	const input: PhotoLibraryBackupSaveRequestV1 = {
		catalogName: 'Summer.sscape', fileTypeDescription: 'Photo catalog', maximumStreamingBytes: 1024,
		prepareSave: (request) => {
			events.push('picker');
			assert.equal(request.purpose, 'project'); assert.equal(request.suggestedName, 'Summer.liscape');
			assert.equal(request.mimeType, SCAPE_MIME_TYPE); assert.equal(request.useFileSystemAccess, true);
			assert.deepEqual(request.types, [{ description: 'Photo catalog', accept: { [SCAPE_MIME_TYPE]: ['.liscape'] } }]);
			return Promise.resolve(prepareDirect(request.signal));
		},
		saveFile: async () => { assert.fail('Streaming does not use Blob delivery'); },
		backupCatalog: async (options) => {
			events.push('backup'); assert.ok(options?.writable); const writer = options.writable.getWriter();
			try { await writer.write(BYTES); await writer.close(); } finally { writer.releaseLock(); }
			return result();
		},
	};
	return { controller, events, writes, input, prepareDirect };
}

test('start invokes the picker in the click stack and reports saved only after exact stream commit', async () => {
	const f = fixture(), work = f.controller.start(f.input);
	assert.deepEqual(f.events, ['picker']); assert.equal(f.controller.isPending(), true);
	const receipt = await work;
	assert.deepEqual(f.events, ['picker', 'open', 'backup', 'commit']); assert.deepEqual(f.writes, [BYTES]);
	assert.deepEqual(receipt, { status: 'saved', catalogId: 'catalog-1', catalogName: 'Summer', photoCount: 3,
		byteLength: 4, fileName: 'Summer.liscape', method: 'file-system-access', notices: [] });
	assert.equal('blob' in receipt, false); assert.equal(Object.isFrozen(receipt), true); assert.equal(f.controller.isPending(), false);
});

test('a held picker blocks close/reopen and another generation until late prepared-target cleanup settles', async () => {
	const f = fixture(), picker = deferred<PreparedDirectSave>(), abort = deferred<void>();
	const prepared = f.prepareDirect();
	const late = { ...prepared, abort: async () => { f.events.push('held-abort'); await abort.promise; } };
	f.events.length = 0;
	const work = f.controller.start({ ...f.input, prepareSave: () => { f.events.push('picker'); return picker.promise; } });
	const observed = work.catch(() => undefined), joining = f.controller.cancelAndJoin();
	await assert.rejects(f.controller.start(f.input), /pending/iu); assert.equal(await remainsPending(joining), true);
	picker.resolve(late); await waitForEvent(f.events, 'held-abort'); assert.equal(await remainsPending(joining), true);
	await assert.rejects(f.controller.start(f.input), /pending/iu); assert.equal(f.events.includes('backup'), false);
	abort.resolve(); await assert.rejects(work, { name: 'AbortError' }); await observed; await joining;
	assert.equal(f.controller.isPending(), false); await f.controller.start(f.input);
});

test('picker dismissal is a scalar cancelled receipt and does not acquire archive resources', async () => {
	const f = fixture();
	const receipt = await f.controller.start({ ...f.input, prepareSave: async () => ({ mode: 'cancelled', cancelled: true, fileName: 'Summer.liscape' }) });
	assert.deepEqual(receipt, { status: 'cancelled' }); assert.deepEqual(f.events, []);
});

test('held destination creation remains owned through cancellation and abort, with no archive call', async () => {
	const f = fixture(), open = deferred<WritableStream<Uint8Array>>(), abort = deferred<void>(), entered = deferred<void>();
	const base = f.prepareDirect();
	const work = f.controller.start({ ...f.input, prepareSave: async () => ({ ...base,
		createWritable: async (maximum, mode) => { assert.equal(maximum, 1024); assert.equal(mode, 'maximum'); entered.resolve(); return open.promise; },
		abort: async () => { f.events.push('held-abort'); await abort.promise; } }) });
	const observed = work.catch(() => undefined); await entered.promise;
	const joining = f.controller.cancelAndJoin(); assert.equal(await remainsPending(joining), true);
	open.resolve(new WritableStream<Uint8Array>()); await waitForEvent(f.events, 'held-abort');
	assert.equal(await remainsPending(joining), true); await assert.rejects(f.controller.start(f.input), /pending/iu);
	abort.resolve(); await assert.rejects(work, { name: 'AbortError' }); await observed; await joining;
	assert.equal(f.events.includes('backup'), false);
});

test('pre-acquisition archive refusal still aborts an opened prepared destination and retains both failures', async () => {
	const f = fixture(), primary = new Error('snapshot unavailable'), cleanup = new Error('abort unavailable');
	const base = f.prepareDirect();
	await assert.rejects(f.controller.start({ ...f.input, prepareSave: async () => ({ ...base, abort: async () => { throw cleanup; } }),
		backupCatalog: async () => { throw primary; } }), (error: unknown) => {
		assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, cleanup]); return true;
	});
	assert.equal(f.controller.isPending(), false);
});

test('stream results require null Blob and exact actual appended bytes before commit', async () => {
	for (const invalid of [result(new Blob([BYTES])), { ...result(), byteLength: 3 }]) {
		const f = fixture(), backup = f.input.backupCatalog;
		await assert.rejects(f.controller.start({ ...f.input, backupCatalog: async options => { await backup(options); return invalid; } }), /stream|byte/iu);
		assert.equal(f.events.includes('commit'), false); assert.equal(f.events.includes('abort'), true);
	}
});

test('a held native commit blocks re-entry; late cancellation joins and retains the durable saved ACK', async () => {
	const f = fixture(), commit = deferred<void>(), entered = deferred<void>();
	const base = f.prepareDirect();
	const work = f.controller.start({ ...f.input, prepareSave: async () => ({ ...base, commit: async () => {
		entered.resolve(); await commit.promise; return { fileName: 'Summer.liscape', method: 'file-system-access', size: 4 };
	} }) });
	await entered.promise; const joining = f.controller.cancelAndJoin();
	assert.equal(await remainsPending(joining), true); await assert.rejects(f.controller.start(f.input), /pending/iu);
	assert.equal(f.events.includes('abort'), false); commit.resolve();
	assert.equal((await work).status, 'saved'); await joining; assert.equal(f.events.includes('abort'), false);
});

test('failed commit still aborts and aggregates cleanup rather than claiming archive completion as saved', async () => {
	const f = fixture(), primary = new Error('commit failed'), cleanup = new Error('discard failed');
	const base = f.prepareDirect();
	await assert.rejects(f.controller.start({ ...f.input, prepareSave: async () => ({ ...base,
		commit: async () => { throw primary; }, abort: async () => { throw cleanup; } }) }), (error: unknown) => {
		assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, cleanup]); return true;
	});
});

test('Blob fallback reuses the selected target and reports download-started without retaining a Blob', async () => {
	const f = fixture(), target = { browserDownload: true as const, name: 'chosen.liscape' }, blob = new Blob([BYTES], { type: SCAPE_MIME_TYPE });
	const receipt = await f.controller.start({ ...f.input,
		prepareSave: async () => ({ mode: 'blob', target, fileName: 'chosen.liscape' }),
		backupCatalog: async options => { assert.equal(options?.writable, undefined); assert.equal(options?.maximumBlobBytes, 512 * 1024 * 1024); return result(blob); },
		saveFile: async request => { assert.equal(request.target, target); assert.equal(request.blob, blob); assert.equal(request.useFileSystemAccess, false);
			assert.equal(request.suggestedName, 'chosen.liscape'); return { method: 'download', fileName: 'chosen.liscape', size: 4 }; },
	});
	assert.equal(receipt.status, 'download-started'); assert.equal('blob' in receipt, false);
});

test('a missing download environment, cancelled delivery or inconsistent Blob cannot produce a saved receipt', async () => {
	for (const mode of ['blob', 'cancelled', 'wrong-bytes'] as const) {
		const f = fixture(), blob = new Blob([BYTES]); let deliveries = 0;
		await assert.rejects(f.controller.start({ ...f.input,
			prepareSave: async () => ({ mode: 'blob', target: { browserDownload: true, name: 'Summer.liscape' }, fileName: 'Summer.liscape' }),
			backupCatalog: async () => ({ ...result(blob), byteLength: mode === 'wrong-bytes' ? 3 : 4 }),
			saveFile: async () => { deliveries++; return mode === 'cancelled' ? { cancelled: true, fileName: 'Summer.liscape', size: 4 }
				: { method: 'blob', fileName: 'Summer.liscape', size: 4, blob }; },
		}), /deliver|Blob|byte/iu);
		assert.equal(deliveries, mode === 'wrong-bytes' ? 0 : 1);
	}
});

test('completed archive cleanup notices survive delivery and late Blob download cancellation', async () => {
	const f = fixture(), delivered = deferred<void>(), entered = deferred<void>(), signal = new AbortController();
	const work = f.controller.start({ ...f.input, signal: signal.signal,
		prepareSave: async () => ({ mode: 'blob', target: { browserDownload: true, name: 'Summer.liscape' }, fileName: 'Summer.liscape' }),
		backupCatalog: async () => ({ ...result(new Blob([BYTES])), notices: ['cleanup-failed'] }),
		saveFile: async request => { entered.resolve(); await delivered.promise; assert.equal(request.signal?.aborted, false);
			return { method: 'download', fileName: 'Summer.liscape', size: 4 }; },
	});
	await entered.promise; signal.abort(); const joining = f.controller.cancelAndJoin(); assert.equal(await remainsPending(joining), true);
	delivered.resolve(); const receipt = await work; assert.equal(receipt.status, 'download-started');
	assert.deepEqual(receipt.notices, ['cleanup-failed']); await joining;
});

test('invalid, accessor and pre-aborted requests are refused before picker invocation', async () => {
	const f = fixture(); let getters = 0;
	for (const request of [ { ...f.input, maximumStreamingBytes: 0 }, { ...f.input, catalogName: 'x'.repeat(257) },
		{ ...f.input, signal: AbortSignal.abort() }, Object.defineProperty({ ...f.input }, 'catalogName', { enumerable: true, get: () => { getters++; return 'Summer'; } }),
		{ ...f.input, futureVersion: 2 } ]) await assert.rejects(f.controller.start(request as PhotoLibraryBackupSaveRequestV1));
	assert.deepEqual(f.events, []); assert.equal(getters, 0); assert.equal(f.controller.isPending(), false);
});

test('external abort reason uses the native signal even if its reason is shadowed after admission', async () => {
	const f = fixture(), stop = new AbortController(), picker = deferred<PreparedDirectSave>(); let getters = 0;
	const work = f.controller.start({ ...f.input, signal: stop.signal, prepareSave: () => picker.promise });
	const observed = work.catch(() => undefined), reason = new DOMException('Cancelled by owner', 'AbortError');
	Object.defineProperty(stop.signal, 'reason', { get: () => { getters++; return new Error('shadow reason'); } });
	stop.abort(reason); picker.resolve(f.prepareDirect());
	await assert.rejects(work, error => error === reason); await observed; assert.equal(getters, 0);
});

test('prepared destination accessors are refused without calling them or starting archive reads', async () => {
	const f = fixture(); let getters = 0;
	const prepared = Object.defineProperty({ ...f.prepareDirect() }, 'bytesWritten', { enumerable: true,
		get: () => { getters++; return () => 4; } });
	await assert.rejects(f.controller.start({ ...f.input, prepareSave: async () => prepared }), /data property/iu);
	assert.equal(getters, 0); assert.equal(f.events.includes('backup'), false); assert.equal(f.events.includes('commit'), false);
});

test('the real direct-save owner joins a cancelled native open and held native abort before reuse', async () => {
	const f = fixture(), open = deferred<{ write(): void; close(): void; abort(): Promise<void> }>(), abort = deferred<void>();
	const entered = deferred<void>(), abortEntered = deferred<void>(); let aborts = 0;
	const work = f.controller.start({ ...f.input, prepareSave: async request => createFileSystemPreparedSave({
		fileName: 'Summer.liscape', signal: request.signal, target: { createWritable: () => { entered.resolve(); return open.promise; } },
	}) });
	const observed = work.catch(() => undefined); await entered.promise; const joining = f.controller.cancelAndJoin();
	open.resolve({ write: () => assert.fail('No writes after cancellation'), close: () => assert.fail('No close after cancellation'),
		abort: async () => { aborts++; abortEntered.resolve(); await abort.promise; } });
	await abortEntered.promise; assert.equal(await remainsPending(joining), true);
	await assert.rejects(f.controller.start(f.input), /pending/iu); abort.resolve();
	await assert.rejects(work, { name: 'AbortError' }); await observed; await joining; assert.equal(aborts, 1);
	assert.equal(f.events.includes('backup'), false); await f.controller.start(f.input);
});

test('cancelled Blob preparation discards the completed archive instead of starting download', async () => {
	const f = fixture(), held = deferred<PhotoLibraryBackupResultV1>(), entered = deferred<void>(); let deliveries = 0;
	const work = f.controller.start({ ...f.input,
		prepareSave: async () => ({ mode: 'blob', target: { browserDownload: true, name: 'Summer.liscape' }, fileName: 'Summer.liscape' }),
		backupCatalog: () => { entered.resolve(); return held.promise; },
		saveFile: async () => { deliveries++; return { method: 'download', fileName: 'Summer.liscape', size: 4 }; },
	});
	const observed = work.catch(() => undefined); await entered.promise; const joining = f.controller.cancelAndJoin();
	assert.equal(await remainsPending(joining), true); held.resolve(result(new Blob([BYTES])));
	await assert.rejects(work, { name: 'AbortError' }); await observed; await joining; assert.equal(deliveries, 0);
});

test('the owning archive bound stages an authentic photo archive before native commit without retaining output in receipts', async () => {
	const f = fixture(), original = photoArchiveFixture(), parts: Uint8Array<ArrayBuffer>[] = [];
	const root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog-1', name: 'Summer', revision: 0, photoCount: 1, folders: [], keywords: [], collections: [] });
	let staged = false, committed = false;
	const maximum = maximumPhotoCatalogStreamingOutputBytesV1();
	assert.equal(Number.isSafeInteger(maximum), true); assert.ok(maximum > 64 * 1024 * 1024 * 1024);
	const receipt = await f.controller.start({ ...f.input, maximumStreamingBytes: maximum,
		prepareSave: async request => createFileSystemPreparedSave({ fileName: 'Summer.liscape', signal: request.signal,
			target: { createWritable: async () => ({ write: value => { assert.ok(value instanceof Uint8Array); parts.push(new Uint8Array(value)); },
				close: () => { assert.equal(staged, true); committed = true; }, abort: () => assert.fail('Valid archive') }) } }),
		backupCatalog: async options => {
			const exported = await exportPhotoCatalogArchiveV1(root, [original], options);
			assert.equal(committed, false); staged = true;
			return { catalogId: root.id, catalogName: root.name, photoCount: root.photoCount,
				byteLength: exported.byteLength, blob: exported.blob, notices: [] };
		},
	});
	assert.equal(committed, true); assert.equal(receipt.status, 'saved'); assert.equal('blob' in receipt, false);
	assert.equal(receipt.byteLength, parts.reduce((sum, part) => sum + part.length, 0));
	let recovered = 0;
	assert.deepEqual(await importPhotoCatalogArchiveV1(new Blob(parts), async () => ({
		writePhoto: async (photo, chunks) => {
			assert.deepEqual(photo, original.photo); const restored: Uint8Array<ArrayBuffer>[] = [];
			for await (const chunk of chunks) restored.push(new Uint8Array(chunk));
			assert.deepEqual(new Uint8Array(await new Blob(restored).arrayBuffer()), new Uint8Array(await original.original.arrayBuffer())); recovered++;
		}, publish: async () => { assert.equal(recovered, 1); }, rollback: async () => assert.fail('Valid committed archive'),
	})), root);
});
