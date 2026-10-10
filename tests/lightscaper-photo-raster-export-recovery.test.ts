/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserFileSaveService } from '../src/common/editor/browser-file-save-service.ts';
import { createFileSystemPreparedSave } from '../src/common/editor/file-save-stream.ts';
import { capturePhotoRasterExportBatchV1 } from '../src/lightscaper/controller/photo-raster-export-batch-v1.ts';
import { createPhotoRasterBatchDownloadDestinations } from '../src/lightscaper/controller/photo-raster-export-batch-download-destinations.ts';
import { createPhotoRasterJournalDestinationsV1, PhotoRasterJournalDestinationErrorV1 } from '../src/lightscaper/controller/photo-raster-export-journal-destinations-v1.ts';
import { reconcilePhotoRasterExportBatchRecoveryV1 } from '../src/lightscaper/controller/photo-raster-export-batch-recovery-v1.ts';
import { createPhotoRasterExportJournalV1, type PhotoRasterExportBindingV1 } from '../src/lightscaper/storage/photo-raster-export-journal-v1.ts';
import { PhotoRasterExportJournalOwnerV1, PhotoRasterExportJournalErrorV1, type PhotoRasterExportJournalSettingsV1 } from '../src/lightscaper/storage/photo-raster-export-journal-owner-v1.ts';
import type { PhotoRasterExportBatchDestinations } from '../src/lightscaper/controller/photo-raster-export-batch-queue.ts';
import type { BrowserFileSaveRequest } from '../src/common/editor/browser-file-save-service.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

function fixture(sidecarEnabled = false) {
	const filenameTemplate = '{index:2}-{name}', plan = capturePhotoRasterExportBatchV1({ schemaVersion: 1, batchId: 'batch', format: 'jpeg', filenameTemplate,
		...(sidecarEnabled ? { sidecarEnabled: true } : {}),
		members: [{ photoId: 'one', versionId: 'master', expectedRevision: 2, sourceFileName: 'One.jpg' }, { photoId: 'two', versionId: 'master', expectedRevision: 3, sourceFileName: 'Two.jpg' }] });
	const binding: Readonly<PhotoRasterExportBindingV1> = { originalSha256: 'a'.repeat(64), recipeSha256: 'b'.repeat(64), lutSha256: ['c'.repeat(64)], ...(sidecarEnabled ? { sidecarSha256: 'd'.repeat(64) } : {}) };
	const value = createPhotoRasterExportJournalV1(plan, { catalogId: 'catalog', filenameTemplate, bindings: [binding, binding] });
	const settings: PhotoRasterExportJournalSettingsV1 & { value: unknown } = {
		value: undefined, async get() { return this.value; }, async putIfAbsent(_key, value) { if (this.value !== undefined) return false; this.value = structuredClone(value); return true; },
		async replaceIfCurrent(_key, expected, value) { if (JSON.stringify(expected) !== JSON.stringify(this.value)) return false; this.value = structuredClone(value); return true; },
	};
	return { plan, value, settings, owner: new PhotoRasterExportJournalOwnerV1(settings, 'catalog'),
		current: { catalogId: 'catalog', members: value.members.map(member => ({ photoId: member.photoId, versionId: member.versionId, expectedRevision: member.expectedRevision, binding: member.binding })) } };
}
function jsonRequest(): BrowserFileSaveRequest { return { blob: new Blob(['{}'], { type: 'application/json' }), mimeType: 'application/json' }; }
function ports(plan: ReturnType<typeof fixture>['plan'], onSave: () => void = () => {}): { -readonly [Key in keyof PhotoRasterExportBatchDestinations]: PhotoRasterExportBatchDestinations[Key] } {
	return { prepareSave: member => ({ mode: 'blob', fileName: member.fileName, target: { browserDownload: true, name: member.fileName } }),
		saveFile: member => { assert.ok(plan.members.includes(member)); onSave(); return { method: 'download', fileName: member.fileName, size: 1 }; }, retireAndJoin: async () => {} };
}
test('recovery preserves stable indices and separates pending, uncertain and acknowledged members', async () => {
	const f = fixture(); await f.owner.create(f.value); await f.owner.started('batch:1');
	assert.deepEqual(reconcilePhotoRasterExportBatchRecoveryV1(f.owner.current, f.current).map(entry => [entry.member.index, entry.disposition]), [[1, 'needs-review'], [2, 'eligible']]);
	const missing = reconcilePhotoRasterExportBatchRecoveryV1(f.owner.current, { catalogId: 'catalog', members: [] });
	assert.equal(missing[0]!.disposition, 'needs-review'); assert.equal(missing[0]!.currentMatches, false);
	await f.owner.committed('batch:1', { status: 'download-started', method: 'download', fileName: '01-One.jpg', size: 1 });
	assert.deepEqual(reconcilePhotoRasterExportBatchRecoveryV1(f.owner.current, { catalogId: 'other', members: [] }).map(entry => entry.disposition), ['already-committed', 'stale']);
	await f.owner.closeAndJoin();
});
test('pending recovery refuses changed version, revision, original, recipe or LUT digests without scheduling', () => {
	const f = fixture();
	for (const changed of [ { ...f.current.members[0]!, versionId: 'new' }, { ...f.current.members[0]!, expectedRevision: 9 },
		...(['originalSha256', 'recipeSha256'] as const).map(key => ({ ...f.current.members[0]!, binding: { ...f.value.members[0]!.binding, [key]: 'd'.repeat(64) } })),
		{ ...f.current.members[0]!, binding: { ...f.value.members[0]!.binding, lutSha256: [] } } ]) {
		assert.equal(reconcilePhotoRasterExportBatchRecoveryV1(f.value, { ...f.current, members: [changed, f.current.members[1]] })[0]!.disposition, 'stale');
	}
});
test('initial gesture acquires captured receivers synchronously; real download owner preserves initiation ACK', async () => {
	const f = fixture(); await f.owner.create(f.value); const names: string[] = [];
	const service = createBrowserFileSaveService({ scope: { showSaveFilePicker: async () => assert.fail('No deferred picker') },
		document: { createElement: () => ({ href: '', hidden: false, download: '', click() { names.push(this.download); } }) },
		urlApi: { createObjectURL: () => 'blob:journal', revokeObjectURL: () => {} }, setTimeout: callback => { callback(); return 1; } });
	let acquired = false;
	const pending = createPhotoRasterJournalDestinationsV1(f.plan, f.owner, () => { acquired = true; return createPhotoRasterBatchDownloadDestinations(f.plan, service); });
	assert.equal(acquired, true); const owner = await pending;
	await owner.prepareSave(f.plan.members[0]!, {}); const saved = await owner.saveFile(f.plan.members[0]!, { bytes: new Uint8Array([1, 2]) });
	assert.equal('method' in saved && saved.method, 'download'); assert.equal(f.owner.current?.members[0]!.state, 'committed');
	assert.deepEqual(names, ['01-One.jpg']); await owner.retireAndJoin();
});
test('refused durable intent prevents native publication; uncertain retry requires explicit review before acquisition', async () => {
	const f = fixture(); await f.owner.create(f.value); let saves = 0, acquisitions = 0;
	f.settings.value = { foreign: true };
	const owner = await createPhotoRasterJournalDestinationsV1(f.plan, f.owner, () => ports(f.plan, () => { saves++; }));
	await assert.rejects(Promise.resolve(owner.saveFile(f.plan.members[0]!, {}))); assert.equal(saves, 0); await assert.rejects(owner.retireAndJoin());
	const retry = fixture(); await retry.owner.create(retry.value); await retry.owner.started('batch:1');
	assert.throws(() => createPhotoRasterJournalDestinationsV1(retry.plan, retry.owner, () => { acquisitions++; return ports(retry.plan); })); assert.equal(acquisitions, 0);
	const reviewed = await createPhotoRasterJournalDestinationsV1(retry.plan, retry.owner, () => ports(retry.plan), { reviewedRetryJobIds: ['batch:1'] });
	await reviewed.saveFile(retry.plan.members[0]!, {}); await reviewed.retireAndJoin();
});
test('actual download ACK survives failed committed publication and retirement; reopen remains needs-review', async () => {
	const f = fixture(); await f.owner.create(f.value); const replace = f.settings.replaceIfCurrent, publication = Symbol('publish'), retirement = Symbol('retire'); let count = 0;
	f.settings.replaceIfCurrent = async function (...args) { if (++count === 2) throw publication; return replace.apply(this, args); };
	// Methods must be captured before creating the journal transport owner.
	const journal = new PhotoRasterExportJournalOwnerV1(f.settings, 'catalog'); await journal.load();
	const native = ports(f.plan); native.retireAndJoin = async () => { throw retirement; };
	const owner = await createPhotoRasterJournalDestinationsV1(f.plan, journal, () => native);
	assert.equal('method' in await owner.saveFile(f.plan.members[0]!, {}) && owner.getReceipt().deliveries.length, 1);
	assert.equal(owner.getReceipt().publicationFailures.length, 1);
	await assert.rejects(owner.retireAndJoin(), (error: unknown) => { assert.ok(error instanceof PhotoRasterJournalDestinationErrorV1); assert.equal(error.failure.cause, retirement); assert.equal(error.failure.receipt.deliveries[0]!.ack.status, 'download-started'); return true; });
	const reopened = new PhotoRasterExportJournalOwnerV1(f.settings, 'catalog'); await reopened.load();
	assert.equal(reconcilePhotoRasterExportBatchRecoveryV1(reopened.current, f.current)[0]!.disposition, 'needs-review'); await reopened.closeAndJoin(); await f.owner.closeAndJoin();
});
test('held commit and held native retirement remain joined after download initiation', async () => {
	const f = fixture(); await f.owner.create(f.value); const replace = f.settings.replaceIfCurrent, write = deferred<void>(), entered = deferred<void>(), retired = deferred<void>(); let calls = 0;
	f.settings.replaceIfCurrent = async function (...args) { if (++calls === 2) { entered.resolve(); await write.promise; } return replace.apply(this, args); };
	const journal = new PhotoRasterExportJournalOwnerV1(f.settings, 'catalog'); await journal.load(); const native = ports(f.plan); native.retireAndJoin = () => retired.promise;
	const owner = await createPhotoRasterJournalDestinationsV1(f.plan, journal, () => native), saved = owner.saveFile(f.plan.members[0]!, {}); await entered.promise;
	assert.equal(owner.getReceipt().deliveries.length, 1); const close = owner.retireAndJoin(); assert.equal(await remainsPending(close), true);
	write.resolve(); await saved; assert.equal(await remainsPending(close), true); retired.resolve(); await close; await f.owner.closeAndJoin();
});
test('retirement during held intent prevents a new native call, while held native ACK survives retirement', async () => {
	const f = fixture(); await f.owner.create(f.value); const replace = f.settings.replaceIfCurrent, entered = deferred<void>(), held = deferred<void>(); let saves = 0;
	f.settings.replaceIfCurrent = async function (...args) { entered.resolve(); await held.promise; return replace.apply(this, args); };
	const journal = new PhotoRasterExportJournalOwnerV1(f.settings, 'catalog'); await journal.load();
	const owner = await createPhotoRasterJournalDestinationsV1(f.plan, journal, () => ports(f.plan, () => { saves++; })), work = owner.saveFile(f.plan.members[0]!, {});
	await entered.promise; const workFailure = assert.rejects(Promise.resolve(work)), close = owner.retireAndJoin(), closeFailure = assert.rejects(close);
	assert.equal(await remainsPending(close), true); held.resolve(); await workFailure; await closeFailure; assert.equal(saves, 0); await f.owner.closeAndJoin();
	const second = fixture(); await second.owner.create(second.value); const native = ports(second.plan), nativeEntered = deferred<void>(), nativeHeld = deferred<void>();
	native.saveFile = async member => { nativeEntered.resolve(); await nativeHeld.promise; return { method: 'download', fileName: member.fileName, size: 3 }; };
	const adapter = await createPhotoRasterJournalDestinationsV1(second.plan, second.owner, () => native), saving = adapter.saveFile(second.plan.members[0]!, {});
	await nativeEntered.promise; const retiring = adapter.retireAndJoin(); assert.equal(await remainsPending(retiring), true); nativeHeld.resolve(); await saving; await retiring; assert.equal(adapter.getReceipt().deliveries.length, 1);
});
test('malformed authority retains safe own retirement, never reads accessor ports, preserves opaque cleanup', async () => {
	const f = fixture(); await f.owner.create(f.value); const held = deferred<void>(), entered = deferred<void>(), cleanup = Symbol('cleanup'); let getters = 0, calls = 0;
	const native = Object.defineProperty(ports(f.plan), 'prepareSave', { enumerable: true, get() { getters++; assert.fail('Accessor capability'); } });
	native.retireAndJoin = async () => { calls++; entered.resolve(); await held.promise; throw cleanup; };
	const acquiring = createPhotoRasterJournalDestinationsV1(f.plan, f.owner, () => native), rejection = assert.rejects(acquiring, (error: unknown) => {
		assert.ok(error instanceof PhotoRasterJournalDestinationErrorV1); assert.ok(error.failure.cause instanceof TypeError); assert.equal(error.failure.cleanup?.cause, cleanup); return true;
	}); await entered.promise; assert.equal(await remainsPending(acquiring), true); held.resolve(); await rejection; assert.equal(getters, 0); assert.equal(calls, 1); await f.owner.closeAndJoin();
});
test('foreign member copies, settings drift and acknowledged members refuse before new authority', async () => {
	const f = fixture(); await f.owner.create(f.value); let calls = 0;
	assert.throws(() => createPhotoRasterJournalDestinationsV1({ ...f.plan, format: 'png' }, f.owner, () => { calls++; return ports(f.plan); })); assert.equal(calls, 0);
	const owner = await createPhotoRasterJournalDestinationsV1(f.plan, f.owner, () => ports(f.plan));
	assert.throws(() => owner.saveFile({ ...f.plan.members[0]! }, {})); await owner.saveFile(f.plan.members[0]!, {}); await owner.retireAndJoin();
	const reopened = new PhotoRasterExportJournalOwnerV1(f.settings, 'catalog'); await reopened.load();
	assert.throws(() => createPhotoRasterJournalDestinationsV1(f.plan, reopened, () => { calls++; return ports(f.plan); })); assert.equal(calls, 0); await reopened.closeAndJoin();
});
test('native opaque primary and cleanup failures retain distinct identity without getter inspection', async () => {
	const f = fixture(); await f.owner.create(f.value); const cleanup = new Proxy({}, { get() { assert.fail('Foreign cleanup getter'); } });
	const native = ports(f.plan); native.saveFile = async () => { throw undefined; }; native.retireAndJoin = async () => { throw cleanup; };
	const owner = await createPhotoRasterJournalDestinationsV1(f.plan, f.owner, () => native);
	await assert.rejects(Promise.resolve(owner.saveFile(f.plan.members[0]!, {})), (cause: unknown) => cause === undefined);
	await assert.rejects(owner.retireAndJoin(), (error: unknown) => { assert.ok(error instanceof PhotoRasterJournalDestinationErrorV1);
		assert.equal(error.failure.cause, undefined); assert.equal(error.failure.cleanup?.cause, cleanup); assert.ok(Object.isFrozen(error.failure)); return true; });
});
test('blob fallback is not a native download ACK and deferred/direct preparation is refused', async () => {
	for (const direct of [false, true]) {
		const f = fixture(); await f.owner.create(f.value); const native = ports(f.plan);
		if (direct) native.prepareSave = () => createFileSystemPreparedSave({ fileName: '01-One.jpg', target: { name: '01-One.jpg', createWritable: async () => assert.fail('Deferred writer must not open') } });
		else native.saveFile = member => ({ method: 'blob', fileName: member.fileName, size: 1, blob: new Blob(['x']) });
		const owner = await createPhotoRasterJournalDestinationsV1(f.plan, f.owner, () => native);
		await assert.rejects(Promise.resolve(direct ? owner.prepareSave(f.plan.members[0]!, {}) : owner.saveFile(f.plan.members[0]!, {})));
		assert.equal(owner.getReceipt().deliveries.length, 0); assert.equal(f.owner.current?.members[0]!.state, direct ? 'pending' : 'started'); await assert.rejects(owner.retireAndJoin());
	}
});
test('aborted held intent and native cancellation never claim a download ACK', async () => {
	const f = fixture(); await f.owner.create(f.value); const stop = new AbortController(); stop.abort(Symbol('stop')); let calls = 0;
	const owner = await createPhotoRasterJournalDestinationsV1(f.plan, f.owner, () => ports(f.plan, () => { calls++; }));
	await assert.rejects(Promise.resolve(owner.saveFile(f.plan.members[0]!, { signal: stop.signal }))); assert.equal(calls, 0); await assert.rejects(owner.retireAndJoin());
	const cancelled = fixture(); await cancelled.owner.create(cancelled.value); const native = ports(cancelled.plan);
	native.saveFile = member => ({ cancelled: true, fileName: member.fileName, size: 0 });
	const adapter = await createPhotoRasterJournalDestinationsV1(cancelled.plan, cancelled.owner, () => native);
	assert.equal('cancelled' in await adapter.saveFile(cancelled.plan.members[0]!, {}), true); assert.equal(adapter.getReceipt().deliveries.length, 0); await adapter.retireAndJoin();
});
test('synchronous initial authority pins native method receivers before its first await', async () => {
	const f = fixture(); await f.owner.create(f.value); let calls = 0;
	const native = ports(f.plan, () => { calls++; }), original = native.saveFile;
	native.saveFile = function (...args) { assert.equal(this, native); return original.apply(this, args); };
	const acquiring = createPhotoRasterJournalDestinationsV1(f.plan, f.owner, () => native);
	native.saveFile = () => assert.fail('Authority changed after initial gesture');
	const owner = await acquiring; await owner.saveFile(f.plan.members[0]!, {}); await owner.retireAndJoin(); assert.equal(calls, 1);
});

test('paired recovery requires both ACKs and keeps uncertain JSON visible even when its saved facts become stale', async () => {
	const f = fixture(true); await f.owner.create(f.value); await f.owner.started('batch:1');
	await f.owner.committed('batch:1', { status: 'download-started', method: 'download', fileName: '01-One.jpg', size: 9 });
	assert.equal(reconcilePhotoRasterExportBatchRecoveryV1(f.owner.current, f.current)[0]!.disposition, 'eligible');
	const changed = { ...f.current, members: [{ ...f.current.members[0]!, binding: { ...f.current.members[0]!.binding, sidecarSha256: 'e'.repeat(64) } }] };
	assert.equal(reconcilePhotoRasterExportBatchRecoveryV1(f.owner.current, changed)[0]!.disposition, 'stale');
	await f.owner.sidecarStarted('batch:1');
	const stale = reconcilePhotoRasterExportBatchRecoveryV1(f.owner.current, changed)[0]!;
	assert.equal(stale.disposition, 'needs-review'); assert.equal(stale.currentMatches, false);
	await f.owner.sidecarCommitted('batch:1', { status: 'download-started', method: 'download', fileName: '01-One.jpg.lightscaper.json', size: 2, mediaType: 'application/json' });
	assert.equal(reconcilePhotoRasterExportBatchRecoveryV1(f.owner.current, changed)[0]!.disposition, 'already-committed'); await f.owner.closeAndJoin();
});

test('actual JSON ACK survives opaque CAS/readback failure and held native retirement alongside its original image ACK', async () => {
	const f = fixture(true); await f.owner.create(f.value); const replace = f.settings.replaceIfCurrent, get = f.settings.get;
	const publication = Symbol('JSON CAS'), readback = Symbol('JSON readback'), entered = deferred<void>(), held = deferred<void>(); let calls = 0, failedRead = false;
	f.settings.get = async function (...args) { if (failedRead) throw readback; return get.apply(this, args); };
	f.settings.replaceIfCurrent = async function (...args) {
		if (++calls === 4) { failedRead = true; throw publication; } return replace.apply(this, args);
	};
	const journal = new PhotoRasterExportJournalOwnerV1(f.settings, 'catalog'); await journal.load();
	const native = ports(f.plan); native.saveSidecar = member => ({ method: 'download', fileName: member.fileName + '.lightscaper.json', size: 2 });
	native.retireAndJoin = async () => { entered.resolve(); await held.promise; };
	const owner = await createPhotoRasterJournalDestinationsV1(f.plan, journal, () => native);
	try {
		await owner.saveFile(f.plan.members[0]!, {}); await owner.saveSidecar!(f.plan.members[0]!, jsonRequest());
		const receipt = owner.getReceipt(); assert.equal(receipt.deliveries[0]!.ack.fileName, '01-One.jpg');
		assert.equal(receipt.sidecarDeliveries![0]!.ack.fileName, '01-One.jpg.lightscaper.json');
		const cause = receipt.publicationFailures[0]!.cause; assert.ok(cause instanceof PhotoRasterExportJournalErrorV1); assert.equal(cause.failure.cause, publication); assert.equal(cause.failure.cleanup?.cause, readback);
		const close = owner.retireAndJoin(); await entered.promise; assert.equal(await remainsPending(close), true); held.resolve(); await close;
		failedRead = false; const reopened = new PhotoRasterExportJournalOwnerV1(f.settings, 'catalog'); await reopened.load();
		assert.equal(reopened.current!.members[0]!.state, 'committed'); assert.equal(reopened.current!.members[0]!.sidecar!.state, 'started');
		assert.equal(reconcilePhotoRasterExportBatchRecoveryV1(reopened.current, f.current)[0]!.disposition, 'needs-review'); await reopened.closeAndJoin();
	} finally { held.resolve(); f.settings.get = get; await journal.closeAndJoin(); await f.owner.closeAndJoin(); }
});

test('paired initial authority pins JSON receiver and refuses truthy companion flags before acquisition', async () => {
	const f = fixture(true); await f.owner.create(f.value); let calls = 0;
	assert.throws(() => createPhotoRasterJournalDestinationsV1({ ...f.plan, sidecarEnabled: 'yes' } as never, f.owner, () => { calls++; return ports(f.plan); })); assert.equal(calls, 0);
	const native = ports(f.plan); native.saveSidecar = function (member) { assert.equal(this, native); calls++; return { method: 'download', fileName: member.fileName + '.lightscaper.json', size: 2 }; };
	const acquiring = createPhotoRasterJournalDestinationsV1(f.plan, f.owner, () => native);
	native.saveSidecar = () => assert.fail('JSON authority changed after gesture');
	const owner = await acquiring; await owner.saveFile(f.plan.members[0]!, {}); await owner.saveSidecar!(f.plan.members[0]!, jsonRequest()); await owner.retireAndJoin(); assert.equal(calls, 1);
});

for (const promised of [false, true]) test(`${promised ? 'held' : 'synchronous'} authority cannot change the admitted paired choice before JSON capability capture`, async () => {
	const f = fixture(true); await f.owner.create(f.value); const plan = { ...f.plan }, held = deferred<PhotoRasterExportBatchDestinations>();
	const native = ports(plan); let json = 0; native.saveSidecar = member => { json++; return { method: 'download', fileName: member.fileName + '.lightscaper.json', size: 2 }; };
	const acquiring = createPhotoRasterJournalDestinationsV1(plan, f.owner, () => {
		if (promised) return held.promise;
		Object.defineProperty(plan, 'sidecarEnabled', { value: false }); return native;
	});
	if (promised) { Object.defineProperty(plan, 'sidecarEnabled', { value: false }); held.resolve(native); }
	const owner = await acquiring;
	try {
		assert.equal(typeof owner.saveSidecar, 'function'); await owner.saveFile(plan.members[0]!, {}); await owner.saveSidecar!(plan.members[0]!, jsonRequest());
		assert.equal(json, 1); assert.equal(owner.getReceipt().sidecarDeliveries![0]!.ack.fileName, '01-One.jpg.lightscaper.json');
		assert.equal(f.owner.current!.members[0]!.sidecar!.state, 'committed');
	} finally { await owner.retireAndJoin(); }
});
