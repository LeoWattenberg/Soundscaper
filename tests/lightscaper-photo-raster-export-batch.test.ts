/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { capturePhotoRasterExportBatchV1 } from '../src/lightscaper/controller/photo-raster-export-batch-v1.ts';
import { PhotoRasterExportBatchQueue, PhotoRasterExportBatchError,
	type PhotoRasterExportBatchRuntime, type PhotoRasterExportBatchDestinations } from '../src/lightscaper/controller/photo-raster-export-batch-queue.ts';
import { defaultImageDevelopStateV2, normalizeImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { createFileSystemPreparedSave } from '../src/common/editor/file-save-stream.ts';
import { encodePixelFramePngV1 } from '../src/common/editor/imaging/pixel-frame-png-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import type { PhotoLibraryDevelopSnapshotV2 } from '../src/common/editor/photo-library-develop-port-v2.ts';
import { deferred, remainsPending, waitForEvent } from './helpers/async-test-control.ts';

function input() {
	return { schemaVersion: 1, batchId: 'batch', format: 'png', filenameTemplate: '{index:2}-{name}', members: [
		{ photoId: 'one', versionId: 'master', expectedRevision: 3, sourceFileName: 'First.png' },
		{ photoId: 'two', versionId: 'master', expectedRevision: 3, sourceFileName: 'Second.png' },
	] };
}
function fixture() {
	const events: string[] = [], writes = new Map<string, Uint8Array>(), frames = new Map<string, PixelFrameV1>();
	const snapshots = new Map<string, PhotoLibraryDevelopSnapshotV2>();
	for (const [photoId, pixels] of [['one', [9, 31, 57, 255]], ['two', [80, 100, 120, 127]]] as const) {
		frames.set(photoId, { descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: new Uint8Array(pixels) });
		snapshots.set(photoId, { schemaVersion: 2, catalogId: 'catalog', photoId, revision: 3, activeVersionId: 'master', versionId: 'master',
			versions: [{ id: 'master', name: 'Master', kind: 'master' }], develop: defaultImageDevelopStateV2(), history: { cursor: 0, entries: [] }, snapshots: [] });
	}
	const hooks = { encode: async () => {}, write: async (_id: string) => {}, commit: async (_id: string) => {}, abort: async (_id: string) => {},
		authority: async () => {}, retire: async () => {}, afterExecute: async () => {} };
	let encoding = '';
	const destinations: PhotoRasterExportBatchDestinations = {
		prepareSave(member, request) {
			assert.equal(this, destinations); events.push(`prepare:${member.photoId}`);
			return createFileSystemPreparedSave({ fileName: member.fileName, signal: request.signal, target: { createWritable: async () => ({
				write: async value => { assert.ok(value instanceof Uint8Array); events.push(`write:${member.photoId}`); await hooks.write(member.photoId); writes.set(member.photoId, new Uint8Array(value)); },
				close: async () => { events.push(`commit:${member.photoId}`); await hooks.commit(member.photoId); },
				abort: async () => { events.push(`abort:${member.photoId}`); await hooks.abort(member.photoId); },
			}) } });
		},
		saveFile: async () => { assert.fail('Native destination must retain streamed publication.'); },
		async retireAndJoin() { assert.equal(this, destinations); events.push('retire'); await hooks.retire(); },
	};
	const runtime: { -readonly [Key in keyof PhotoRasterExportBatchRuntime]: PhotoRasterExportBatchRuntime[Key] } = {
		fileTypeDescription: 'PNG image',
		prepareDestinations(plan, options) { assert.equal(this, runtime); assert.equal(plan.format, 'png'); assert.ok(options.signal); events.push('authority'); return hooks.authority().then(() => destinations); },
		execute: async (action, signal) => {
			assert.ok(signal); await action({ signal, isCurrent: () => true, refresh: async () => undefined, acquire: async () => ({ schemaVersion: 2,
				read: async request => { encoding = request.photoId; events.push(`read:${request.photoId}`); return snapshots.get(request.photoId)!; },
				apply: async () => assert.fail('Batch export must never edit a photo'),
			}) }); await hooks.afterExecute();
		},
		withOriginalFrame: async (request, consume) => {
			events.push(`original:${request.photoId}`); const result = await consume({ photoId: request.photoId, revision: 3, frame: frames.get(request.photoId)! });
			events.push(`original-settled:${request.photoId}`); return result;
		},
		loadRenderer: async () => createPhotoDevelopRenderRuntimeV2(),
		encode: async (format, frame, options) => { assert.equal(format, 'png'); events.push(`encode:${encoding}`); await hooks.encode(); return encodePixelFramePngV1(frame, options); },
	};
	return { owner: new PhotoRasterExportBatchQueue(runtime), runtime, destinations, events, writes, frames, snapshots, hooks };
}
function captureFailure(value: unknown): PhotoRasterExportBatchError {
	assert.ok(value instanceof PhotoRasterExportBatchError); assert.equal(Object.isFrozen(value.failure), true);
	assert.equal(Object.isFrozen(value.failure.receipt), true); return value;
}

test('batch capture detaches ordered identities, revisions, settings and stable filename indices', () => {
	const value = { ...input(), output: { sizing: { kind: 'fit', width: 64, height: 48, allowUpscale: false }, quality: 'bilinear' } };
	const plan = capturePhotoRasterExportBatchV1(value);
	value.members.reverse(); value.members[0]!.expectedRevision = 9; value.output.sizing.width = 1;
	assert.deepEqual(plan.members.map(member => [member.jobId, member.photoId, member.versionId, member.expectedRevision, member.index, member.fileName]),
		[['batch:1', 'one', 'master', 3, 1, '01-First.png'], ['batch:2', 'two', 'master', 3, 2, '02-Second.png']]);
	assert.deepEqual(plan.output?.sizing, { kind: 'fit', width: 64, height: 48, allowUpscale: false });
	assert.equal(Object.isFrozen(plan), true); assert.equal(Object.isFrozen(plan.members), true); assert.equal(Object.isFrozen(plan.members[0]), true);
});

test('collision, duplicate identity, sparse/oversized arrays and accessor plans refuse before authority acquisition', async () => {
	const f = fixture(), value = input(); let getters = 0;
	const accessor = Object.defineProperty({ ...value }, 'filenameTemplate', { enumerable: true, get() { getters++; return '{name}'; } });
	for (const candidate of [accessor, { ...value, filenameTemplate: 'same' }, { ...value, members: [value.members[0], value.members[0]] },
		{ ...value, members: new Array(2) }, { ...value, members: Array.from({ length: 257 }, () => value.members[0]) },
		{ ...value, filenameTemplate: '{name}', members: value.members.map((member, index) => ({ ...member, sourceFileName: index ? 'É.png' : 'e\u0301.png' })) }]) {
		assert.throws(() => capturePhotoRasterExportBatchV1(candidate));
	}
	await assert.rejects(f.owner.start(accessor)); assert.equal(getters, 0); assert.deepEqual(f.events, []);
});

for (const [key, value] of [['photoId', ' one'], ['versionId', 'bad/id']] as const) {
	test(`single-owner invalid ${key} refuses before acquiring destination authority`, async () => {
		const f = fixture(), candidate = input(); candidate.members[0]![key] = value;
		const error = captureFailure(await f.owner.start(candidate).catch((cause: unknown) => cause));
		assert.ok(error.failure.cause instanceof TypeError); assert.deepEqual(f.events, []);
		assert.throws(() => capturePhotoRasterExportBatchV1(candidate), TypeError);
	});
}

test('capture metadata without the selected reader refuses before acquiring destination authority', async () => {
	const f = fixture(), candidate = { ...input(), output: { sizing: { kind: 'original' }, quality: 'bilinear', metadataScope: 'capture' } };
	const error = captureFailure(await f.owner.start(candidate).catch((cause: unknown) => cause));
	assert.ok(error.failure.cause instanceof TypeError); assert.deepEqual(f.events, []);
});

test('an acquired authority with an accessor save port is retired once without reading its getter', async () => {
	const f = fixture(); let getters = 0, retired = 0;
	const authority = Object.defineProperty({ ...f.destinations, retireAndJoin: async () => { retired++; } }, 'prepareSave',
		{ enumerable: true, get() { getters++; return f.destinations.prepareSave; } });
	f.runtime.prepareDestinations = () => authority;
	const owner = new PhotoRasterExportBatchQueue(f.runtime), error = captureFailure(await owner.start(input()).catch((cause: unknown) => cause));
	await owner.cancelAndJoin(); assert.ok(error.failure.cause instanceof TypeError);
	assert.equal(retired, 1); assert.equal(getters, 0); assert.deepEqual(f.events, []);
});

test('opaque destination admission and retirement failures retain their distinct identities', async () => {
	const opaque = new Proxy({}, { get() { assert.fail('Foreign admission error property read'); } });
	for (const primary of [Symbol('admission'), undefined, opaque]) {
		const f = fixture(), cleanup = Symbol('retirement'); let retired = 0;
		const authority: PhotoRasterExportBatchDestinations = new Proxy({ ...f.destinations, async retireAndJoin() { assert.equal(this, authority); retired++; throw cleanup; } },
			{ getOwnPropertyDescriptor(target, key) { if (key === 'prepareSave') throw primary; return Reflect.getOwnPropertyDescriptor(target, key); } });
		f.runtime.prepareDestinations = () => authority;
		const owner = new PhotoRasterExportBatchQueue(f.runtime), error = captureFailure(await owner.start(input()).catch((cause: unknown) => cause));
		assert.equal(error.failure.cause, primary); assert.equal(error.failure.cleanup?.cause, cleanup);
		assert.equal(retired, 1); assert.equal(Object.isFrozen(error.failure.cleanup), true); assert.deepEqual(f.events, []);
	}
});

test('malformed destination admission keeps global cancellation joined to held retirement', async () => {
	const f = fixture(), held = deferred<void>(); let retired = 0;
	const authority: PhotoRasterExportBatchDestinations = Object.defineProperty({ ...f.destinations, async retireAndJoin() { assert.equal(this, authority); retired++; await held.promise; } },
		'prepareSave', { enumerable: true, value: 4 });
	f.runtime.prepareDestinations = () => authority;
	const owner = new PhotoRasterExportBatchQueue(f.runtime), work = owner.start(input()).catch((cause: unknown) => cause);
	try {
		await new Promise<void>(resolve => { setImmediate(resolve); }); assert.equal(retired, 1);
		const cancelling = owner.cancelAndJoin(); assert.equal(await remainsPending(cancelling), true); assert.equal(await remainsPending(work), true);
		held.resolve(); await cancelling; assert.ok(captureFailure(await work).failure.cause instanceof TypeError);
		assert.equal(retired, 1); assert.deepEqual(f.events, []);
	} finally { held.resolve(); await work; }
});

test('inherited or accessor retirement capabilities are never invoked for malformed authority', async () => {
	for (const inherited of [false, true]) {
		const f = fixture(); let cleanupReads = 0;
		const authority = inherited ? Object.create({ retireAndJoin() { cleanupReads++; } }) as PhotoRasterExportBatchDestinations
			: Object.defineProperty({ ...f.destinations }, 'retireAndJoin', { enumerable: true, get() { cleanupReads++; return f.destinations.retireAndJoin; } });
		f.runtime.prepareDestinations = () => authority;
		const owner = new PhotoRasterExportBatchQueue(f.runtime); await assert.rejects(owner.start(input()), PhotoRasterExportBatchError);
		assert.equal(cleanupReads, 0); assert.deepEqual(f.events, []);
	}
});

test('start captures prior-authorized destination acquisition in the original gesture and pins its receiver', async () => {
	const f = fixture(), held = deferred<void>(); f.hooks.authority = () => held.promise;
	const work = f.owner.start(input()); assert.deepEqual(f.events, ['authority']); assert.equal(f.owner.getSnapshot().phase, 'preparing');
	f.runtime.prepareDestinations = () => { assert.fail('Mutable authority replacement used'); };
	assert.equal(await remainsPending(work), true); held.resolve();
	const receipt = await work; assert.deepEqual(receipt.members.map(member => member.state), ['completed', 'completed']);
	assert.equal(f.events.filter(event => event === 'authority').length, 1);
});

test('two actual full-resolution PNGs run serially, pause between members, and retain originals', async () => {
	const f = fixture(), commit = deferred<void>(); f.hooks.commit = id => id === 'one' ? commit.promise : Promise.resolve();
	const originals = [...f.frames.values()].map(frame => [...frame.pixels]);
	const work = f.owner.start(input()); await waitForEvent(f.events, 'commit:one'); f.owner.pause(); commit.resolve();
	await waitForEvent(f.events, 'original-settled:one'); await new Promise<void>(resolve => { setImmediate(resolve); });
	assert.equal(f.events.includes('prepare:two'), false); assert.equal(await remainsPending(work), true); f.owner.resume();
	const receipt = await work; assert.deepEqual(receipt.members.map(member => member.delivery?.status), ['saved', 'saved']);
	for (const [id, frame] of f.frames) assert.deepEqual(f.writes.get(id), await encodePixelFramePngV1(frame));
	assert.deepEqual([...f.frames.values()].map(frame => [...frame.pixels]), originals);
	assert.ok(f.events.indexOf('prepare:two') > f.events.indexOf('commit:one'));
	assert.equal(f.events.at(-1), 'retire');
});

test('a queued member whose photo revision changes fails without replacing its captured revision or publishing', async () => {
	const f = fixture(), held = deferred<void>(); f.hooks.commit = id => id === 'one' ? held.promise : Promise.resolve();
	const work = f.owner.start(input()).catch((error: unknown) => error); await waitForEvent(f.events, 'commit:one');
	f.snapshots.set('two', { ...f.snapshots.get('two')!, revision: 4 }); held.resolve();
	const error = captureFailure(await work); assert.deepEqual(error.failure.receipt.members.map(member => member.state), ['completed', 'failed']);
	assert.equal(error.failure.receipt.members[1]!.expectedRevision, 3); assert.equal(f.writes.has('two'), false);
});

test('a pending Cube body replacement is refused by the real full-resolution resource owner', async () => {
	const f = fixture(), body = new TextEncoder().encode(`LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => '0.25 0 0\n').join('')}`);
	const sha256 = createHash('sha256').update(body).digest('hex'), held = deferred<void>();
	f.snapshots.set('two', { ...f.snapshots.get('two')!, develop: normalizeImageDevelopStateV2({ ...defaultImageDevelopStateV2(), effects: [{
		id: 'cube', type: 'cube-lut-profile-v1', enabled: true, params: { lut: { storageKey: `lut-sha256:${sha256}`, sha256, byteLength: body.length,
			size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] } },
	}] }) });
	f.runtime.loadRenderer = async () => createPhotoDevelopRenderRuntimeV2({ source: { withBytes: async (_reference, consume) => consume(body) } });
	// Construct after installing this capability: the queue pins it at construction.
	const owner = new PhotoRasterExportBatchQueue(f.runtime); f.hooks.commit = id => id === 'one' ? held.promise : Promise.resolve();
	const work = owner.start(input()).catch((error: unknown) => error); await waitForEvent(f.events, 'commit:one'); body[0] = 0; held.resolve();
	const error = captureFailure(await work); assert.equal(error.failure.receipt.members[1]!.state, 'failed'); assert.equal(f.writes.has('two'), false);
});

test('active cancellation joins held encoding and classifies only that member before starting its neighbor', async () => {
	const f = fixture(), held = deferred<void>(); let first = true;
	f.hooks.encode = () => { if (!first) return Promise.resolve(); first = false; return held.promise; };
	const work = f.owner.start(input()); await waitForEvent(f.events, 'encode:one');
	const cancellation = f.owner.cancelMember('batch:1'); assert.equal(await remainsPending(cancellation), true); assert.equal(f.events.includes('prepare:two'), false);
	held.resolve(); await cancellation; const receipt = await work;
	assert.deepEqual(receipt.members.map(member => member.state), ['cancelled', 'completed']); assert.equal(f.writes.has('one'), false);
});

test('active cancellation joins native write and abort drain before its neighbor can acquire a destination', async () => {
	const f = fixture(), write = deferred<void>(), abort = deferred<void>();
	f.hooks.write = id => id === 'one' ? write.promise : Promise.resolve(); f.hooks.abort = () => abort.promise;
	const work = f.owner.start(input()); await waitForEvent(f.events, 'write:one');
	const cancelling = f.owner.cancelMember('batch:1'); await waitForEvent(f.events, 'abort:one');
	assert.equal(await remainsPending(cancelling), true); assert.equal(f.events.includes('prepare:two'), false);
	abort.resolve(); assert.equal(await remainsPending(cancelling), true); write.resolve(); await cancelling;
	assert.deepEqual((await work).members.map(member => member.state), ['cancelled', 'completed']);
});

test('cancelMember preserves a held native ACK and resolves after classification independently of its held neighbor', async () => {
	const f = fixture(), commit = deferred<void>(), neighbor = deferred<void>();
	f.hooks.commit = id => id === 'one' ? commit.promise : Promise.resolve();
	f.hooks.write = id => id === 'two' ? neighbor.promise : Promise.resolve();
	const work = f.owner.start(input()); await waitForEvent(f.events, 'commit:one');
	const cancellation = f.owner.cancelMember('batch:1'); assert.equal(await remainsPending(cancellation), true); commit.resolve();
	await waitForEvent(f.events, 'write:two'); await cancellation;
	assert.equal(f.owner.getSnapshot().members[0]!.state, 'completed'); assert.equal(f.owner.getSnapshot().members[0]!.delivery?.status, 'saved');
	assert.equal(await remainsPending(work), true); neighbor.resolve(); await work;
});

test('queued cancellation does not abort its unrelated active native publication', async () => {
	const f = fixture(), held = deferred<void>(); f.hooks.commit = () => held.promise;
	const work = f.owner.start(input()); await waitForEvent(f.events, 'commit:one'); await f.owner.cancelMember('batch:2');
	assert.equal(f.events.includes('abort:one'), false); assert.equal(await remainsPending(work), true); held.resolve();
	assert.deepEqual((await work).members.map(member => member.state), ['completed', 'cancelled']); assert.equal(f.events.includes('prepare:two'), false);
});

test('global cancellation joins late destination capture and retirement without starting any member', async () => {
	const f = fixture(), authority = deferred<void>(), retire = deferred<void>(); f.hooks.authority = () => authority.promise; f.hooks.retire = () => retire.promise;
	const work = f.owner.start(input()), cancelling = f.owner.cancelAndJoin(); assert.equal(await remainsPending(cancelling), true);
	authority.resolve(); await waitForEvent(f.events, 'retire'); assert.equal(await remainsPending(cancelling), true); retire.resolve(); await cancelling;
	assert.deepEqual((await work).members.map(member => member.state), ['cancelled', 'cancelled']); assert.equal(f.events.some(event => event.startsWith('prepare:')), false);
});

test('pausing/resuming held authority cannot start work early and owns the later paused queue', async () => {
	const f = fixture(), authority = deferred<void>(); f.hooks.authority = () => authority.promise;
	const work = f.owner.start(input()); f.owner.resume(); f.owner.pause();
	assert.equal(f.events.some(event => event.startsWith('prepare:')), false); authority.resolve();
	await new Promise<void>(resolve => { setImmediate(resolve); });
	assert.equal(f.owner.getSnapshot().phase, 'running'); assert.equal(f.events.some(event => event.startsWith('prepare:')), false);
	f.owner.resume(); await work;
});

test('an opaque synchronous authority throw retains identity and never starts queued members', async () => {
	const f = fixture(), primary = Symbol('authority'); f.runtime.prepareDestinations = () => { throw primary; };
	const owner = new PhotoRasterExportBatchQueue(f.runtime), error = captureFailure(await owner.start(input()).catch((failure: unknown) => failure));
	assert.equal(error.failure.cause, primary); assert.deepEqual(error.failure.receipt.members.map(member => member.state), ['cancelled', 'cancelled']);
	assert.deepEqual(f.events, []);
});

test('opaque Symbol, undefined and proxy primaries plus distinct cleanup causes retain exact identity in immutable failures', async () => {
	const proxy = new Proxy({}, { get() { assert.fail('Foreign error property read'); }, getPrototypeOf() { assert.fail('Foreign error prototype read'); } });
	for (const primary of [Symbol('primary'), undefined, proxy]) {
		const cleanup = Symbol('cleanup'), f = fixture(); f.runtime.execute = async () => { throw primary; }; f.hooks.retire = async () => { throw cleanup; };
		const owner = new PhotoRasterExportBatchQueue(f.runtime), error = captureFailure(await owner.start(input()).catch((failure: unknown) => failure));
		assert.equal(error.failure.cause, primary); assert.equal(error.failure.cleanup?.cause, cleanup); assert.equal(Object.isFrozen(error.failure.cleanup), true);
		assert.deepEqual(error.failure.receipt.members.map(member => member.state), ['failed', 'failed']);
	}
});

test('committed receipts survive late workflow failure and distinct destination retirement failure', async () => {
	const f = fixture(), late = Symbol('late borrowed workflow'), cleanup = new Proxy({}, { get() { assert.fail('Cleanup getter'); } });
	f.hooks.afterExecute = async () => { throw late; }; f.hooks.retire = async () => { throw cleanup; };
	const error = captureFailure(await f.owner.start(input()).catch((failure: unknown) => failure));
	assert.equal(error.failure.cause, cleanup); assert.deepEqual(error.failure.receipt.members.map(member => member.state), ['completed', 'completed']);
	assert.deepEqual(error.failure.receipt.members.map(member => member.delivery?.status), ['saved', 'saved']); assert.equal(f.writes.size, 2);
});

test('scalar progress observes saved classification, isolates observer throws, and unsubscribes without revoking work', async () => {
	const f = fixture(), held = deferred<void>(), snapshots: ReturnType<PhotoRasterExportBatchQueue['getSnapshot']>[] = [];
	f.hooks.commit = id => id === 'one' ? held.promise : Promise.resolve();
	const unsubscribe = f.owner.subscribe(snapshot => { snapshots.push(snapshot); throw Symbol('observer'); });
	const work = f.owner.start(input()); await waitForEvent(f.events, 'commit:one');
	assert.equal(snapshots.some(snapshot => snapshot.members[0]?.state === 'running'), true);
	held.resolve(); const receipt = await work;
	assert.equal(snapshots.some(snapshot => snapshot.members[0]?.state === 'completed' && snapshot.members[0].delivery?.status === 'saved'), true);
	assert.equal(snapshots.at(-1)?.phase, 'settled'); assert.equal(snapshots.every(snapshot => Object.isFrozen(snapshot) && Object.isFrozen(snapshot.members)), true);
	unsubscribe(); unsubscribe(); const count = snapshots.length; await f.owner.cancelAndJoin(); assert.equal(snapshots.length, count);
	assert.deepEqual(receipt.members.map(member => member.state), ['completed', 'completed']);
});
