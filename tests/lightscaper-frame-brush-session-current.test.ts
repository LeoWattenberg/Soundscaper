/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { editableImageFixture, PROFILE } from './helpers/framescaper-editable-image-current-fixture.ts';
import { bindFramescaperImageDevelopAuthoringCurrentV1, framescaperImageDevelopAuthoringForCurrentV1 } from '../src/framescaper/editor-selected-timeline-image-develop-authoring-controller-v1.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import type { FramescaperImageSourceSetCommandTimelineImage } from '../src/framescaper/editor-project-timeline-image-image-command.ts';
import { withPreparedBrushMaskResourceV1, type BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createFramescaperProjectHistory, executeFramescaperProjectCommand, undoFramescaperProjectCommand, redoFramescaperProjectCommand } from '../src/framescaper/editor-project-history.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import type { FramescaperImageDevelopAuthoringSessionCurrentV1 } from '../src/framescaper/editor-selected-timeline-image-develop-authoring-controller-v1.ts';
import type { ImageBrushMaskResourcePortV1 } from '../src/common/editor/image-brush-mask-resource-port-v1.ts';
import type { FramescaperImageBrushMaskAcknowledgementCurrentV1 } from '../src/framescaper/internal/selected-image-brush-mask-port-current-v1.ts';
import type { OwnedMediaAssetWriter } from '../src/common/editor/storage/media-asset-write-contract.ts';
import { videoPreviewAuthoringPausedV1 } from '../src/common/editor/controller/clip-video/video-preview-authoring-suspension-v1.ts';
import { LUT, LUT_BODY } from './helpers/framescaper-editable-image-current-fixture.ts';
interface BrushPort { readonly projectId: string; install(reference: unknown, bytes: unknown): Promise<{ reference: BrushMaskResourceReferenceV1; created: boolean; projectId: string }> }
const priorKey = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (priorKey) Object.defineProperty(globalThis, 'IDBKeyRange', priorKey); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
function child(session: FramescaperImageDevelopAuthoringSessionCurrentV1) {
	const value = (session as typeof session & { brushMasks?: ImageBrushMaskResourcePortV1<FramescaperImageBrushMaskAcknowledgementCurrentV1> & { projectId: string } }).brushMasks;
	assert.ok(value); return value;
}
function deferred<Value>() { let resolve!: (value: Value | PromiseLike<Value>) => void; const promise = new Promise<Value>(yes => { resolve = yes; }); return { promise, resolve }; }
function observed<Value>(promise: Promise<Value>) { return promise.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
async function pending(promise: Promise<unknown>) { let settled = false; void promise.then(() => { settled = true; }, () => { settled = true; }); await new Promise<void>(resolve => setImmediate(resolve)); return !settled; }
async function fixture(cube = false, wrap?: (writer: OwnedMediaAssetWriter) => OwnedMediaAssetWriter) {
	const f = editableImageFixture({ crop: false, ...(cube ? { cube: false } : {}) }), indexedDB = createInstrumentedIndexedDB();
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: indexedDB as unknown as IDBFactory, preferOpfs: false });
	await store.writeMediaAsset(f.source.storageKey, new Blob([new Uint8Array(f.pack.bytes)]), { kind: 'timeline-image', encoding: 'framescaper-image-asset-v1', mimeType: f.source.mimeType, name: f.source.name });
	if (cube) await store.writeMediaAsset(LUT.storageKey, new Blob([LUT_BODY]));
	let history = createFramescaperProjectHistory(PROFILE, f.project()); const commands: FramescaperImageSourceSetCommandTimelineImage[] = [];
	const controller = { project: history.present, getSnapshot: () => ({ selectedClipId: f.clip.id, readOnly: false }), actions: { edit: { commit(command: FramescaperImageSourceSetCommandTimelineImage) {
		commands.push(command); history = executeFramescaperProjectCommand(PROFILE, history, command); controller.project = history.present;
	} } } };
	const borrowed = { loadMediaAsset: store.loadMediaAsset.bind(store), getMediaAssetMetadata: store.getMediaAssetMetadata.bind(store),
		async beginMediaAssetWrite(...args: Parameters<typeof store.beginMediaAssetWrite>) { const writer = await store.beginMediaAssetWrite(...args) as OwnedMediaAssetWriter; return wrap ? wrap(writer) : writer; } };
	bindFramescaperImageDevelopAuthoringCurrentV1({ controller, store: borrowed });
	return { ...f, indexedDB, store, controller, commands, open: () => framescaperImageDevelopAuthoringForCurrentV1(controller)!.open(),
		undo() { history = undoFramescaperProjectCommand(PROFILE, history); controller.project = history.present; },
		redo() { history = redoFramescaperProjectCommand(PROFILE, history); controller.project = history.present; } };
}
function recipe(session: FramescaperImageDevelopAuthoringSessionCurrentV1, reference: BrushMaskResourceReferenceV1) {
	return normalizeImageDevelopStateCurrentV1({ ...session.develop, masks: [{ schemaVersion: 2, id: 'paint', name: 'Painted mask', kind: 'matte',
		inputs: [{ name: 'paint', kind: 'alpha', sourceRef: reference.storageKey }], nodes: [{ id: 'paint', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'paint' }] });
}

test('actual selected Frame Session installs an immutable brush through its real native project store', async () => {
	const f = editableImageFixture({ crop: false }), prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
	Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
	const store = createProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false, databaseName: `frame-brush-${crypto.randomUUID()}` });
	const controller = { project: f.project(), getSnapshot: () => ({ selectedClipId: f.clip.id, readOnly: false }), actions: { edit: { commit(command: FramescaperImageSourceSetCommandTimelineImage) {
		controller.project = applyFramescaperProjectCommand(PROFILE, controller.project, command);
	} } } };
	let session: Awaited<ReturnType<NonNullable<ReturnType<typeof framescaperImageDevelopAuthoringForCurrentV1>>['open']>> | undefined;
	try {
		await store.writeMediaAsset(f.source.storageKey, new Blob([new Uint8Array(f.pack.bytes)]), { kind: 'timeline-image', encoding: 'framescaper-image-asset-v1', mimeType: f.source.mimeType, name: f.source.name });
		bindFramescaperImageDevelopAuthoringCurrentV1({ controller, store }); session = await framescaperImageDevelopAuthoringForCurrentV1(controller)!.open();
		const child = (session as typeof session & { brushMasks?: BrushPort }).brushMasks;
		assert.ok(child, 'The actual Frame Session must own native brush installation.'); const before = structuredClone(controller.project);
		await withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: Uint8Array.of(0, 255) }, async body => {
			const expected = body.bytes.slice(), ack = await child.install(body.reference, body.bytes);
			assert.equal(ack.projectId, controller.project.id); assert.deepEqual(ack.reference, body.reference); assert.equal(ack.created, true);
			const stored = await store.loadMediaAsset(body.reference.storageKey); assert.ok(stored); assert.deepEqual(new Uint8Array(await stored.arrayBuffer()), expected);
		});
		assert.deepEqual(controller.project, before);
	} finally { await session?.closeAndJoin(); await store.close(); if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); }
});

test('native reuse is authenticated, borrowed bytes retire, and unrelated unacknowledged bodies stay inaccessible', async () => {
	const f = await fixture(), session = await f.open();
	try {
		await withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: Uint8Array.of(0, 255) }, async body => {
			const port = child(session), first = await port.install(body.reference, body.bytes), before = await f.store.getMediaAssetMetadata(body.reference.storageKey);
			assert.equal(first.created, true); assert.deepEqual(first.notices, []); assert.equal((await port.install(body.reference, body.bytes)).created, false);
			let lent: Uint8Array | undefined; await port.source.withBytes(body.reference, bytes => { lent = bytes; assert.deepEqual(bytes, body.bytes); });
			assert.ok(lent!.every(byte => byte === 0)); assert.deepEqual(await f.store.getMediaAssetMetadata(body.reference.storageKey), before);
			await withPreparedBrushMaskResourceV1({ width: 1, height: 1, alpha: Uint8Array.of(37) }, async other => {
				await f.store.writeMediaAsset(other.reference.storageKey, new Blob([new Uint8Array(other.bytes)]), { kind: 'photo-mask-raster', encoding: 'lightscaper-mask-raster-v1', mimeType: 'application/octet-stream' });
				await assert.rejects(port.source.withBytes(other.reference, () => assert.fail()), /neither retained nor acknowledged/u);
			});
		}); assert.equal(f.commands.length, 0);
	} finally { await session.closeAndJoin(); await f.store.close(); }
});

test('install snapshots body and reference before its first yield, then exact native Save/CAS/reopen and real history retain it', async () => {
	const f = await fixture(), originalProject = await f.store.createScapeProjectIfAbsent(f.controller.project); assert.ok(originalProject);
	const session = await f.open();
	try {
		const originalPack = new Uint8Array(await (await f.store.loadMediaAsset(f.source.storageKey))!.arrayBuffer());
		await withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: Uint8Array.of(16, 240) }, async body => {
			const bytes = body.bytes.slice(), reference = { ...body.reference }, expected = body.bytes.slice(), work = child(session).install(reference, bytes);
			bytes.fill(0); reference.sha256 = '0'.repeat(64); const ack = await work; assert.deepEqual(ack.reference, body.reference);
			const develop = replaceImageDevelopRepairSpotsV1(recipe(session, body.reference), { schemaVersion: 1, spots: [{ id: 'repair', mode: 'clone', enabled: true,
				target: { x: .75, y: .25 }, source: { x: .25, y: .25 }, radius: .1, feather: 0, opacity: 1 }] });
			session.apply(develop); assert.equal(f.commands.length, 1); const changed = structuredClone(f.controller.project), source = changed.sources.find(value => value.id === f.source.id)!;
			assert.equal(source.schemaVersion, 3); assert.deepEqual(source.original, f.source.original); assert.equal(source.storageKey, f.source.storageKey);
			assert.equal(source.contentSha256, f.source.contentSha256); assert.equal(source.conversionReceiptSha256, f.source.conversionReceiptSha256);
			f.undo(); assert.deepEqual(f.controller.project, { ...originalProject, revision: f.controller.project.revision, updatedAt: f.controller.project.updatedAt });
			assert.ok(f.controller.project.revision > changed.revision); assert.deepEqual(f.controller.project.sources, originalProject.sources);
			f.redo(); assert.deepEqual(f.controller.project, { ...changed, revision: f.controller.project.revision, updatedAt: f.controller.project.updatedAt });
			assert.deepEqual(f.controller.project.sources, changed.sources); const redone = structuredClone(f.controller.project);
			assert.deepEqual(await f.store.saveProjectIfCurrent(originalProject, redone), redone); assert.equal(await f.store.saveProjectIfCurrent(originalProject, redone), null);
			assert.deepEqual(await f.store.loadProject(redone.id), redone); assert.deepEqual(new Uint8Array(await (await f.store.loadMediaAsset(body.reference.storageKey))!.arrayBuffer()), expected);
			assert.deepEqual(new Uint8Array(await (await f.store.loadMediaAsset(f.source.storageKey))!.arrayBuffer()), originalPack);
			await session.closeAndJoin(); const reopened = await f.open();
			try { await child(reopened).source.withBytes(body.reference, actual => assert.deepEqual(actual, expected)); } finally { await reopened.closeAndJoin(); }
		});
	} finally { await session.closeAndJoin(); await f.store.close(); }
});

test('each accepted install reauthenticates retained disabled LUT before beginning a native writer', async () => {
	let writers = 0; const f = await fixture(true, writer => { writers++; return writer; }), session = await f.open();
	try {
		await f.store.deleteMediaAsset(LUT.storageKey);
		await withPreparedBrushMaskResourceV1({ width: 1, height: 1, alpha: Uint8Array.of(255) }, async body => {
			await assert.rejects(child(session).install(body.reference, body.bytes), /LUT|missing/iu); assert.equal(await f.store.getMediaAssetMetadata(body.reference.storageKey), null);
		}); assert.equal(writers, 0); assert.equal(f.commands.length, 0);
	} finally { await session.closeAndJoin(); await f.store.close(); }
});

test('pre-ACK cancellation joins a held genuine writer, aborts staging, and Close retains preview suspension until drain', async () => {
	const entered = deferred<void>(), release = deferred<void>(); let aborts = 0, heldBytes: Uint8Array | undefined;
	const f = await fixture(false, writer => ({ maximumChunkBytes: writer.maximumChunkBytes, get bytesWritten() { return writer.bytesWritten; },
		async write(bytes, options) { heldBytes = bytes; entered.resolve(); await release.promise; return writer.write(bytes, options); },
		commit: writer.commit.bind(writer), commitOwned: writer.commitOwned.bind(writer), async abort() { aborts++; await writer.abort(); } }));
	const session = await f.open(); let closing: Promise<void> | undefined;
	try {
		await withPreparedBrushMaskResourceV1({ width: 1, height: 1, alpha: Uint8Array.of(255) }, async body => {
			const work = observed(child(session).install(body.reference, body.bytes)); assert.equal(await Promise.race([entered.promise.then(() => true), work.then(() => false)]), true);
			assert.throws(() => session.apply(recipe(session, body.reference)), /join before Apply/u); await assert.rejects(session.withOriginalFrame(() => undefined), /already pending/u);
			closing = session.closeAndJoin(); assert.equal(await pending(closing), true); assert.equal(videoPreviewAuthoringPausedV1(f.controller), true); assert.ok(heldBytes!.some(byte => byte !== 0));
			release.resolve(); assert.equal((await work).ok, false); await closing; assert.equal(aborts, 1); assert.ok(heldBytes!.every(byte => byte === 0));
			assert.equal(await f.store.getMediaAssetMetadata(body.reference.storageKey), null); assert.equal(videoPreviewAuthoringPausedV1(f.controller), false); assert.equal(f.commands.length, 0);
		});
	} finally { release.resolve(); await closing; await session.closeAndJoin(); await f.store.close(); }
});

test('a completed real native ACK survives held delivery, opaque late cancellation and project drift without recipe publication', async () => {
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); let aborts = 0;
	const f = await fixture(false, writer => ({ maximumChunkBytes: writer.maximumChunkBytes, get bytesWritten() { return writer.bytesWritten; }, write: writer.write.bind(writer), commit: writer.commit.bind(writer),
		async commitOwned(options) { const publication = await writer.commitOwned(options); entered.resolve(); await release.promise; return publication; }, async abort() { aborts++; await writer.abort(); } }));
	const session = await f.open();
	try {
		await withPreparedBrushMaskResourceV1({ width: 1, height: 1, alpha: Uint8Array.of(43) }, async body => {
			const work = observed(child(session).install(body.reference, body.bytes, { signal: stop.signal }));
			assert.equal(await Promise.race([entered.promise.then(() => true), work.then(() => false)]), true); const expected = body.bytes.slice();
			stop.abort(opaque.proxy); f.controller.project = { ...f.controller.project, name: 'Changed after native ACK' }; release.resolve(); const outcome = await work;
			assert.ok(outcome.ok); assert.equal(outcome.value.created, true); assert.deepEqual(outcome.value.reference, body.reference); assert.equal(outcome.value.projectId, f.controller.project.id);
			assert.equal(aborts, 0); assert.equal(f.commands.length, 0); assert.deepEqual(new Uint8Array(await (await f.store.loadMediaAsset(body.reference.storageKey))!.arrayBuffer()), expected);
		});
	} finally { release.resolve(); await session.closeAndJoin(); await f.store.close(); }
});

test('opaque preabort refuses install before hostile reference reflection and native writes', async () => {
	let writers = 0, traps = 0; const f = await fixture(false, writer => { writers++; return writer; }), session = await f.open(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); stop.abort(opaque.proxy);
	try {
		const reference = new Proxy({}, { ownKeys() { traps++; throw new Error('Late reflection'); } });
		const result = await observed(child(session).install(reference, null, { signal: stop.signal })); assert.ok(!result.ok); assert.ok(Object.is(result.error, opaque.proxy)); assert.equal(traps, 0); assert.equal(writers, 0);
	} finally { await session.closeAndJoin(); await f.store.close(); }
});
