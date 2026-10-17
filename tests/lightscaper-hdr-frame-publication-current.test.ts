/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test, { after } from 'node:test';
import type { OwnedMediaAssetWriter } from '../src/common/editor/storage/media-asset-write-contract.ts';
import { createFramescaperProjectStore, framescaperProjectStoreAuthority } from '../src/framescaper/editor-project-store.ts';
import { createFramescaperProject, cloneFramescaperProject, type FramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { createFramescaperProjectHistory, executeFramescaperProjectCommand, type FramescaperProjectHistory } from '../src/framescaper/editor-project-history.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import * as adoptionOwners from '../src/framescaper/editor-timeline-image-current-project-publication-timeline-image.ts';
import { hdrFrameFixtureCurrentV1 } from './helpers/lightscaper-hdr-frame-current-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const CURRENT_PUBLISHER = new URL('../src/framescaper/editor-timeline-image-hdr-publication-current-v1.ts', import.meta.url);
const previousRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previousRange) Object.defineProperty(globalThis, 'IDBKeyRange', previousRange); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });

interface Request { readonly expected: FramescaperProject; readonly project: FramescaperProject; readonly bytes: Uint8Array<ArrayBuffer>; readonly signal?: AbortSignal; }
interface Publisher { publishIfCurrent(request: Request): Promise<FramescaperProject | null>; }
interface CurrentModule { readonly FramescaperTimelineImageHdrPublisherCurrentV1: new (profile: unknown, dependencies: unknown) => Publisher; }
async function publisherModule(): Promise<CurrentModule> {
	assert.ok(existsSync(CURRENT_PUBLISHER), 'A named HDR-only Frame publication owner is required.');
	return await import(CURRENT_PUBLISHER.href) as CurrentModule;
}

async function fixture() {
	const hdr = await hdrFrameFixtureCurrentV1(), database = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: database, preferOpfs: false }); await store.ready();
	const authority = framescaperProjectStoreAuthority(PROFILE, store), base = createFramescaperProject(PROFILE, { now: '2026-10-16T15:00:00.000Z' });
	assert.ok(await store.createProjectIfAbsent(base));
	const source = hdr.source, clip = { schemaVersion: 1, kind: 'image', id: 'generated-hdr-clip', sourceId: source.id,
		sequenceId: base.primarySequenceId, sequenceStartFrame: 0, sequenceFrameCount: 150, sourceStartTicks: '0' } as const;
	const command = { type: 'batch', commands: [
		{ type: 'image-source/set', sourceId: source.id, expectedSource: null, source },
		{ type: 'image-clip/set', clipId: clip.id, expectedClip: null, expectedPlacement: null, clip, placement: { scope: 'project-bin' } },
	] };
	const project = applyFramescaperProjectCommand(PROFILE, base, command, { now: '2026-10-16T15:00:01.000Z' });
	const request: Request = { expected: base, project, bytes: new Uint8Array(hdr.pack.bytes) };
	const current = () => {
		const owner = (authority as typeof authority & { readonly hdrImages?: Publisher }).hdrImages;
		assert.ok(owner, 'The actual Current Frame store must compose its named hdrImages authority.'); return owner;
	};
	return { hdr, store, authority, base, source, clip, command, project, request, current };
}

test('Current native Frame publication roots one authenticated Source5 and its ProjectBin clip in exactly the next project revision', async t => {
	const f = await fixture(); t.after(() => f.store.close());
	const published = await f.current().publishIfCurrent(f.request); assert.deepEqual(published, f.project);
	assert.deepEqual(await f.store.loadProject(f.base.id), f.project);
	assert.deepEqual(new Uint8Array(await (await f.store.loadMediaAsset(f.source.storageKey))!.arrayBuffer()), f.hdr.pack.bytes);
	const metadata = await f.store.getMediaAssetMetadata(f.source.storageKey); assert.ok(metadata);
	assert.equal(metadata.sha256, f.source.contentSha256); assert.equal(metadata.size, f.source.assetByteLength);
	assert.equal(Object.hasOwn(metadata, 'pendingProjectUntil'), false, 'The project CAS must publish the committed body root.');
	assert.deepEqual(f.project.clips, f.base.clips); assert.equal(f.project.projectBin.clips.filter(value => value.id === f.clip.id).length, 1);
	assert.deepEqual(f.project.sources.find(value => value.id === f.source.id), f.source);
});

test('the permanent Source1 still publisher keeps rejecting a native HDR source before writing any body', async t => {
	const f = await fixture(); t.after(() => f.store.close());
	await assert.rejects(() => f.authority.timelineImages.publishIfCurrent(f.request), /unsupported|version|field|canonical/iu);
	assert.deepEqual(await f.store.loadProject(f.base.id), f.base); assert.equal(await f.store.loadMediaAsset(f.source.storageKey), null);
});

test('a stale native Frame HDR project CAS discards only the newly owned body and preserves the winning project', async t => {
	const f = await fixture(); t.after(() => f.store.close()); const publisher = f.current();
	const winner = cloneFramescaperProject(PROFILE, { ...f.base, revision: f.base.revision + 1, title: 'Concurrent project edit', updatedAt: '2026-10-16T15:00:02.000Z' });
	assert.deepEqual(await f.store.saveProjectIfCurrent(f.base, winner), winner);
	assert.equal(await publisher.publishIfCurrent(f.request), null);
	assert.deepEqual(await f.store.loadProject(f.base.id), winner); assert.equal(await f.store.loadMediaAsset(f.source.storageKey), null);
	assert.deepEqual(f.hdr.pack.bytes, f.request.bytes, 'Refused publication must leave caller-owned input bytes unchanged.');
});

test('native HDR publication joins a held write before propagating an opaque abort and retires its unpublished body', async t => {
	const module = await publisherModule(), f = await fixture(); t.after(() => f.store.close());
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Object.freeze({ frameHdr: 'cancelled' });
	const events: string[] = [];
	const store = {
		async beginMediaAssetWrite(...args: Parameters<typeof f.store.beginMediaAssetWrite>) {
			const native = await f.store.beginMediaAssetWrite(...args) as OwnedMediaAssetWriter;
			assert.equal(typeof native.commitOwned, 'function');
			return { maximumChunkBytes: native.maximumChunkBytes, get bytesWritten() { return native.bytesWritten; },
				async write(bytes: Uint8Array<ArrayBuffer>, options?: { signal?: AbortSignal }) { entered.resolve(); await release.promise; await native.write(bytes, options); },
				commit: native.commit.bind(native), commitOwned: native.commitOwned.bind(native),
				async abort() { await native.abort(); events.push('abort:joined'); },
			};
		}, getMediaAssetMetadata: f.store.getMediaAssetMetadata.bind(f.store), deleteMediaAsset: f.store.deleteMediaAsset.bind(f.store),
	};
	const publisher = new module.FramescaperTimelineImageHdrPublisherCurrentV1(PROFILE, { port: f.authority.port, store });
	const work = publisher.publishIfCurrent({ ...f.request, signal: stop.signal }); void work.catch(() => undefined);
	try {
		await entered.promise; stop.abort(reason); assert.equal(await remainsPending(work), true); assert.deepEqual(await f.store.loadProject(f.base.id), f.base);
		release.resolve(); await assert.rejects(work, error => Object.is(error, reason)); assert.deepEqual(events, ['abort:joined']);
		assert.equal(await f.store.loadMediaAsset(f.source.storageKey), null); assert.deepEqual(await f.store.loadProject(f.base.id), f.base);
	} finally { release.resolve(); await Promise.allSettled([work]); }
});

test('native HDR writer failure preserves distinct opaque primary and physical cleanup failures', async t => {
	const module = await publisherModule(), f = await fixture(); t.after(() => f.store.close());
	const primary = Object.freeze({ write: 'failed' }), cleanup = Object.freeze({ abort: 'failed' });
	const store = { async beginMediaAssetWrite() { return { maximumChunkBytes: 4096, bytesWritten: 0,
		async write() { throw primary; }, async commit() { assert.fail('A failed write cannot commit.'); },
		async commitOwned() { assert.fail('A failed write cannot publish.'); }, async abort() { throw cleanup; } }; },
		getMediaAssetMetadata: f.store.getMediaAssetMetadata.bind(f.store), deleteMediaAsset: f.store.deleteMediaAsset.bind(f.store) };
	const publisher = new module.FramescaperTimelineImageHdrPublisherCurrentV1(PROFILE, { port: f.authority.port, store });
	await assert.rejects(() => publisher.publishIfCurrent(f.request), error => error instanceof AggregateError
		&& error.errors.some((value: unknown) => Object.is(value, primary)) && error.errors.some((value: unknown) => Object.is(value, cleanup)));
	assert.deepEqual(await f.store.loadProject(f.base.id), f.base); assert.equal(await f.store.loadMediaAsset(f.source.storageKey), null);
});

test('Current Frame adoption returns the real committed HDR acknowledgement with a notice after late history or cancellation failure', async t => {
	const f = await fixture(); t.after(() => f.store.close()); const native = f.current();
	type AdoptionFactory = (options: unknown) => { publish(request: unknown): Promise<Readonly<{ project: FramescaperProject; notices: readonly string[] }>> };
	const create = (adoptionOwners as unknown as { createFramescaperTimelineImageHdrCurrentProjectPublicationV1?: AdoptionFactory }).createFramescaperTimelineImageHdrCurrentProjectPublicationV1;
	assert.equal(typeof create, 'function', 'Current HDR adoption must preserve a durable ACK through later presentation failure.'); assert.ok(create);
	const history = createFramescaperProjectHistory(PROFILE, f.base), token = {}, stop = new AbortController(), late = Object.freeze({ history: 'superseded after durable publication' });
	let committed = false, updated = false;
	const controller = { project: f.base, actions: { project: { async openById() { assert.fail('Superseded local history cannot be overwritten.'); } } } };
	const adoption = create({ controller,
		session: { captureProjectHistory: () => ({ history, token }), assertProjectHistoryToken(_id: string, value: unknown) { assert.equal(value, token); if (committed) throw late; },
			updateProjectHistory(_id: string, _value: FramescaperProjectHistory) { updated = true; }, markProjectSaved() {}, getProjectHistory: () => history },
		executeCommand: (value: FramescaperProjectHistory, command: unknown, options: { now: Date | string }) => executeFramescaperProjectCommand(PROFILE, value, command, options),
		async publishIfCurrent(request: Request) { const project = await native.publishIfCurrent(request); assert.ok(project); committed = true; stop.abort(late); return project; },
		now: () => '2026-10-16T15:00:01.000Z',
	});
	const ack = await adoption.publish({ project: f.base, source: f.source, clip: f.clip, command: f.command,
		body: new Blob([f.request.bytes], { type: f.source.mimeType }), signal: stop.signal });
	assert.deepEqual(ack.project, f.project); assert.ok(ack.notices.length > 0); assert.equal(updated, false);
	assert.deepEqual(await f.store.loadProject(f.base.id), f.project);
	assert.ok(await f.store.loadMediaAsset(f.source.storageKey), 'A genuine committed body must never be rolled back by late cancellation or history adoption failure.');
});
