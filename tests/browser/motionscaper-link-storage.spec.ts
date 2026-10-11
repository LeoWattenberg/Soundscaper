/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FramescaperCompositionLinkRepository } from '../../src/framescaper/editor-composition-link-repository.ts';
import type { MotionCompositionOffer } from '../../src/common/editor/motion-link-protocol.ts';
import type { MotionAsset } from '../../src/common/editor/motion-asset.ts';
import type { FramescaperCompositionLinkOwnerRepository, FramescaperCompositionLinkOwnerReceipt } from '../../src/framescaper/editor-composition-link-owner-repository.ts';
import type { FramescaperSuccessorHistory } from '../../src/framescaper/editor-project-successor-history.ts';
import type { MotionCompositionLinkState } from '../../src/common/editor/motion-link-state.ts';

interface Fixture {
	open(): Promise<FramescaperCompositionLinkRepository>; offer(revision: number, width?: number): MotionCompositionOffer;
	bytes: Uint8Array<ArrayBuffer>; asset: MotionAsset; database(): Promise<IDBDatabase>;
	archive(): Promise<{ archive: Blob; projectId: string; sourceId: string; digest: string }>;
	owner(): Promise<FramescaperCompositionLinkOwnerRepository>;
	pair(): Promise<{ current: FramescaperCompositionLinkOwnerReceipt; undone: FramescaperSuccessorHistory }>;
	accept(history: FramescaperSuccessorHistory, state: MotionCompositionLinkState, sourceId: string): FramescaperSuccessorHistory;
	undo(history: FramescaperSuccessorHistory): FramescaperSuccessorHistory;
}
let directory: string; let server: Server; let address: string;
const repository = fileURLToPath(new URL('../../', import.meta.url));
test.beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'motionscaper-link-browser-'));
	const entry = join(directory, 'fixture.ts'); const output = join(directory, 'site');
	const source = (path: string) => JSON.stringify(join(repository, path));
	await writeFile(entry, `
import { openFramescaperCompositionLinkRepository } from ${source('src/framescaper/editor-composition-link-repository.ts')};
import { openFramescaperSuccessorDatabase } from ${source('src/framescaper/editor-project-successor-database.ts')};
import { createMotionCompositionOffer } from ${source('src/common/editor/motion-link-protocol.ts')};
import { createMotionscaperRevision } from ${source('src/common/editor/motion-project-revision.ts')};
import { createMotionscaperProject } from ${source('src/motionscaper/editor-project.ts')};
import { digestScapeBytes } from ${source('src/common/editor/scape-archive-media.ts')};
import { BlobWriter, TextReader, ZipWriter } from ${source('node_modules/@zip.js/zip.js/index-native.js')};
import { createFramescaperBaselineImageFixture } from ${source('tests/helpers/framescaper-baseline-image-fixture.ts')};
import { createFramescaperProject } from ${source('src/framescaper/editor-project.ts')};
import { applyFramescaperProjectCommand } from ${source('src/framescaper/editor-project-commands.ts')};
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from ${source('src/framescaper/editor-project-runtime-profile.ts')};
import { migrateFramescaperSuccessorProject } from ${source('src/framescaper/editor-project-successor.ts')};
import { createFramescaperCompositionLink } from ${source('src/framescaper/editor-project-successor-link.ts')};
import { digestFramescaperMigrationArchive } from ${source('src/framescaper/editor-project-successor-archive.ts')};
import { exportFramescaperLinkedSuccessorArchive } from ${source('src/framescaper/editor-project-successor-linked-archive.ts')};
import { openFramescaperCompositionLinkOwnerRepository } from ${source('src/framescaper/editor-composition-link-owner-repository.ts')};
import { createFramescaperSuccessorHistory, executeFramescaperSuccessorHistory, undoFramescaperSuccessorHistory } from ${source('src/framescaper/editor-project-successor-history.ts')};
const bytes = new Uint8Array([1,2,3,4]); const sha256 = digestScapeBytes(bytes);
const asset = { id: 'image', kind: 'image', name: 'Image', mimeType: 'image/png', width: 1, height: 1, hasAlpha: true, sha256, byteLength: bytes.length, storageKey: 'motion-sha256:' + sha256 };
async function archive() {
 const image = createFramescaperBaselineImageFixture({imageOnly:true});
 const frame = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE,createFramescaperProject(),{type:'image-source/set',sourceId:image.source.id,expectedSource:null,source:image.source});
 const text = JSON.stringify(frame); const descriptor = {entry:'framescaper/timelineImage/image/'+image.source.id+'/body',sourceId:'framescaper:image:'+image.source.id,kind:'framescaper-image-asset',encoding:'framescaper-image-asset-v1',mimeType:image.source.mimeType,size:image.bytes.length,sha256:digestScapeBytes(image.bytes)};
 const writer = new ZipWriter(new BlobWriter(),{level:0,useWebWorkers:false}); await writer.add('project.json',new TextReader(text));
 await writer.add('manifest.json',new TextReader(JSON.stringify({format:'scape-project',formatVersion:1,project:{entry:'project.json',schemaFamily:'framescaper',schemaVersion:1,size:new TextEncoder().encode(text).length,sha256:digestScapeBytes(new TextEncoder().encode(text))},assets:[descriptor]})));
 await writer.add(descriptor.entry,new Blob([image.bytes]).stream()); const originalArchive = await writer.close();
 const snapshot = createMotionscaperRevision({...createMotionscaperProject({id:'motion',compositionId:'main',title:'Portable'}),assets:[asset]});
 const project = {...migrateFramescaperSuccessorProject(frame),compositionLinks:[createFramescaperCompositionLink(image.source.id,'main',snapshot)]};
 const archive = await exportFramescaperLinkedSuccessorArchive({id:frame.id,project,originalArchive,archiveDigest:await digestFramescaperMigrationArchive(originalArchive)},{readAsset:async()=>({size:bytes.length,stream:()=>new Blob([bytes]).stream()})});
 return {archive,projectId:frame.id,sourceId:image.source.id,digest:snapshot.digest};
}
function accept(history,state,sourceId) { return executeFramescaperSuccessorHistory(history,{type:'composition-link/replace',sourceId,expectedDigest:history.present.compositionLinks.find(link=>link.sourceId===sourceId)?.acceptedDigest??null,link:createFramescaperCompositionLink(sourceId,state.accepted.compositionId,state.accepted.revision),commands:[]},{now:'2026-10-11T00:00:00.000Z'}); }
async function pair() {
 const image=createFramescaperBaselineImageFixture({imageOnly:true}); const ids=[image.source.id,'image-source-2'];
 const project=migrateFramescaperSuccessorProject({...image.project,sources:[...image.project.sources,{...image.source,id:ids[1],storageKey:ids[1]}]});
 const owner=await openFramescaperCompositionLinkOwnerRepository({line:'successor'});
 try {
  let current=await owner.saveOwner(project,null,createFramescaperSuccessorHistory(project));
  for(const revision of [1,2]) for(const sourceId of ids) {
   const offer=createMotionCompositionOffer('main',createMotionscaperRevision({...createMotionscaperProject({id:'motion-'+sourceId,compositionId:'main',title:'Revision '+revision}),revision}));
   const prepared=await owner.prepareReceive(project.id,sourceId,offer,{readAsset:async()=>null}); const history=accept(current.history,prepared.state,sourceId);
   current=await prepared.commit({expectedOwnerDigest:current.ownerDigest,project:history.present,history});
  }
  const undone=undoFramescaperSuccessorHistory(undoFramescaperSuccessorHistory(current.history)); return {current,undone};
 } finally {await owner.close();}
}
globalThis.motionLinkFixture = { bytes, asset, archive, accept, pair, undo: history=>undoFramescaperSuccessorHistory(history,{now:'2026-10-11T00:00:00.000Z'}), owner:()=>openFramescaperCompositionLinkOwnerRepository({line:'successor'}), open: () => openFramescaperCompositionLinkRepository({line:'successor'}), database: () => openFramescaperSuccessorDatabase(indexedDB,'successor'),
 offer: (revision, width = 1920) => createMotionCompositionOffer('main', createMotionscaperRevision({...createMotionscaperProject({id:'motion',compositionId:'main',title:'Revision ' + revision,width}),revision,assets:[asset]})) };
`);
	await build({ root: repository, configFile: false, publicDir: false, logLevel: 'silent', build: { outDir: output, emptyOutDir: true, rolldownOptions: { input: entry, output: { entryFileNames: 'fixture.js' } } } });
	server = createServer((request, response) => { void (async () => {
		try {
			if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<script type="module" src="/fixture.js"></script>'); return; }
			if (request.url !== '/fixture.js') { response.writeHead(404).end(); return; }
			response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(join(output, 'fixture.js')));
		} catch { response.writeHead(404).end(); }
	})(); });
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const bound = server.address();
	if (!bound || typeof bound === 'string') throw new Error('Motion link fixture could not bind.'); address = `http://127.0.0.1:${bound.port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); if (directory) await rm(directory, { recursive: true, force: true }); });
test.beforeEach(async ({ page }) => { await page.goto(address); await page.waitForFunction(() => 'motionLinkFixture' in globalThis); });

test('M10 real IndexedDB keeps streamed dependencies private until atomic publication and reopens without either editor', async ({ page }) => {
	const result = await page.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionLinkFixture: Fixture }).motionLinkFixture; const receiver = await fixture.open();
		let release!: () => void; let staged!: () => void; let count = 0;
		const started = new Promise<void>((resolve) => { staged = resolve; }); const finish = new Promise<void>((resolve) => { release = resolve; });
		const transfer = receiver.receive('frame', 'linked', fixture.offer(1), { readAsset: async () => ({ size: 4, stream: () => new ReadableStream<Uint8Array>({ async pull(controller) {
			if (++count === 1) controller.enqueue(fixture.bytes.slice(0, 2)); else { staged(); await finish; controller.enqueue(fixture.bytes.slice(2)); controller.close(); }
		} }, { highWaterMark: 0 }) }) });
		await started; const before = await receiver.load('frame', 'linked'); release(); const accepted = await transfer; await receiver.close();
		const reopened = await fixture.open(); const loaded = await reopened.load('frame', 'linked'); const body = await reopened.readAsset(fixture.asset);
		const bytes = body ? [...new Uint8Array(await new Response(body.stream()).arrayBuffer())] : null; await reopened.close();
		return { before, accepted: accepted.accepted.revision.digest, loaded: loaded?.accepted.revision.digest, bytes, names: (await indexedDB.databases()).map((database) => database.name) };
	});
	expect(result.before).toBeNull(); expect(result.loaded).toBe(result.accepted); expect(result.bytes).toEqual([1, 2, 3, 4]); expect(result.names).toEqual(['kw-media-framescaper-editor-v2']);
});

test('M10 cancelling a stalled real storage transfer preserves the accepted snapshot and removes private chunks', async ({ page }) => {
	const result = await page.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionLinkFixture: Fixture }).motionLinkFixture; const receiver = await fixture.open();
		const readAsset = async () => ({ size: 4, stream: () => new Blob([fixture.bytes]).stream() }); await receiver.receive('frame', 'linked', fixture.offer(1), { readAsset });
		const abort = new AbortController(); let ready!: () => void; let cancelled = 0; let count = 0; const started = new Promise<void>((resolve) => { ready = resolve; });
		const pending = receiver.receive('frame', 'linked', fixture.offer(2), { signal: abort.signal, readAsset: async () => ({ size: 4, stream: () => new ReadableStream<Uint8Array>({
			pull(controller) { if (++count === 1) controller.enqueue(fixture.bytes.slice(0, 2)); else ready(); }, cancel() { cancelled++; },
		}, { highWaterMark: 0 }) }) });
		const rejected = pending.then(() => 'published', (error: unknown) => error instanceof Error ? error.name : 'failure'); await started; abort.abort(); const error = await rejected;
		const state = await receiver.load('frame', 'linked'); const database = await fixture.database();
		const stores = await new Promise<number[]>((resolve, reject) => { const transaction = database.transaction(['staging', 'chunks', 'assets'], 'readonly'); const counts = ['staging', 'chunks', 'assets'].map((name) => transaction.objectStore(name).count()); transaction.oncomplete = () => resolve(counts.map((request) => request.result)); transaction.onabort = () => reject(transaction.error); });
		database.close(); await receiver.close(); return { error, cancelled, revision: state?.accepted.revision.revision, stores };
	});
	expect(result).toEqual({ error: 'AbortError', cancelled: 1, revision: 1, stores: [0, 1, 1] });
});

test('M10 real storage retains incompatible updates and Undo pause across reopen before Resume and Conform', async ({ page }) => {
	const result = await page.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionLinkFixture: Fixture }).motionLinkFixture; const receiver = await fixture.open(); const readAsset = async () => ({ size: 4, stream: () => new Blob([fixture.bytes]).stream() });
		await receiver.receive('frame', 'linked', fixture.offer(1), { readAsset }); await receiver.receive('frame', 'linked', fixture.offer(2), { readAsset }); await receiver.restore('frame', 'linked', fixture.offer(1));
		await receiver.receive('frame', 'linked', fixture.offer(3, 1280), { readAsset }); await receiver.close(); const reopened = await fixture.open(); const paused = await reopened.load('frame', 'linked');
		const resumed = await reopened.resume('frame', 'linked'); const conformed = await reopened.conform('frame', 'linked'); const historical = await reopened.loadRevision('motion', fixture.offer(1).revision.digest); await reopened.close();
		return { paused: paused?.paused, accepted: paused?.accepted.revision.revision, pending: paused?.pending?.revision.revision, resumed: resumed.accepted.revision.revision, conformed: conformed.accepted.revision.revision, historical: historical?.revision };
	});
	expect(result).toEqual({ paused: true, accepted: 1, pending: 3, resumed: 1, conformed: 3, historical: 1 });
});

test('M10 real storage imports a portable linked project atomically and recovers from owner write failure', async ({ page }) => {
	const result = await page.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionLinkFixture: Fixture }).motionLinkFixture; const portable = await fixture.archive(); const receiver = await fixture.open();
		const original = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<typeof original>) { if (this.name === 'linkStates') throw new DOMException('Planned storage failure', 'QuotaExceededError'); return original.apply(this, args); };
		let failure = '';
		try { await receiver.importArchive(portable.archive); } catch (error) { failure = error instanceof Error ? error.name : 'failure'; }
		finally { IDBObjectStore.prototype.put = original; }
		const database = await fixture.database();
		const stores = ['projects', 'linkStates', 'linkRevisions', 'assets', 'chunks', 'staging'];
		const before = await new Promise<number[]>((resolve, reject) => { const transaction = database.transaction(stores, 'readonly'); const counts = stores.map((name) => transaction.objectStore(name).count()); transaction.oncomplete = () => resolve(counts.map((request) => request.result)); transaction.onabort = () => reject(transaction.error); });
		database.close(); const imported = await receiver.importArchive(portable.archive); await receiver.close(); const reopened = await fixture.open(); const loaded = await reopened.load(portable.projectId, portable.sourceId);
		const body = await reopened.readAsset(fixture.asset); const bytes = body ? [...new Uint8Array(await new Response(body.stream()).arrayBuffer())] : null; await reopened.close();
		return { failure, before, id: imported.id, expectedId: portable.projectId, digest: loaded?.accepted.revision.digest, expectedDigest: portable.digest, bytes };
	});
	expect(result.failure).toBe('QuotaExceededError'); expect(result.before).toEqual([0, 0, 0, 0, 0, 0]); expect(result.id).toBe(result.expectedId); expect(result.digest).toBe(result.expectedDigest); expect(result.bytes).toEqual([1, 2, 3, 4]);
});

test('M10 real owner transactions keep history and accepted links together through failure, Undo and offline reopen', async ({ page }) => {
	const result = await page.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionLinkFixture: Fixture }).motionLinkFixture; const portable = await fixture.archive(); const receiver = await fixture.open(); await receiver.importArchive(portable.archive); await receiver.close();
		const owner = await fixture.owner(); const initial = await owner.loadOwner(portable.projectId); if (!initial) throw new Error('Imported owner is unavailable.');
		const options = { readAsset: async () => ({ size: 4, stream: () => new Blob([fixture.bytes]).stream() }) };
		const prepared = await owner.prepareReceive(portable.projectId, portable.sourceId, fixture.offer(1), options); const history = fixture.accept(initial.history, prepared.state, portable.sourceId);
		const original = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<typeof original>) { if (this.name === 'owners') throw new DOMException('Owner write failed', 'QuotaExceededError'); return original.apply(this, args); };
		let failure = '';
		try { await prepared.commit({ expectedOwnerDigest: initial.ownerDigest, project: history.present, history }); } catch (error) { failure = error instanceof Error ? error.name : 'failure'; } finally { IDBObjectStore.prototype.put = original; }
		const preserved = await owner.loadOwner(portable.projectId); const retry = await owner.prepareReceive(portable.projectId, portable.sourceId, fixture.offer(1), options); const retried = fixture.accept(initial.history, retry.state, portable.sourceId);
		const accepted = await retry.commit({ expectedOwnerDigest: initial.ownerDigest, project: retried.present, history: retried });
		const undone = fixture.undo(accepted.history); const previous = initial.linkStates[0]!.state.accepted; const restore = await owner.prepareTransition(portable.projectId, portable.sourceId, { type: 'restore', offer: previous });
		const paused = await restore.commit({ expectedOwnerDigest: accepted.ownerDigest, project: undone.present, history: undone }); await owner.close(); const reopened = await fixture.owner(); const loaded = await reopened.loadOwner(portable.projectId); await reopened.close();
		return { failure, initial: initial.ownerDigest, preserved: preserved?.ownerDigest, history: accepted.history.undoStack.length, accepted: accepted.project.compositionLinks[0]?.acceptedRevision, paused: paused.linkStates[0]?.state.paused, restored: loaded?.project.compositionLinks[0]?.acceptedDigest, expected: portable.digest, same: loaded?.ownerDigest === paused.ownerDigest };
	});
	expect(result.failure).toBe('QuotaExceededError'); expect(result.preserved).toBe(result.initial); expect(result.history).toBe(1); expect(result.accepted).toBe(1); expect(result.paused).toBe(true); expect(result.restored).toBe(result.expected); expect(result.same).toBe(true);
});

test('M10 a second real tab fences an unchanged owner against late link publication and deletion', async ({ page, context }) => {
	await page.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionLinkFixture: Fixture }).motionLinkFixture;
		const portable = await fixture.archive(); const receiver = await fixture.open(); await receiver.importArchive(portable.archive); await receiver.close();
		const owner = await fixture.owner(); const initial = await owner.loadOwner(portable.projectId); if (!initial) throw new Error('Imported owner is unavailable.');
		const fence = await owner.claimOwnerWriteFence(portable.projectId);
		const prepared = await owner.prepareReceive(portable.projectId, portable.sourceId, fixture.offer(1), { readAsset: async () => ({ size: 4, stream: () => new Blob([fixture.bytes]).stream() }) });
		const history = fixture.accept(initial.history, prepared.state, portable.sourceId);
		Object.assign(globalThis, { motionLinkTakeover: { owner, initial, prepared, history, fence } });
	});
	const second = await context.newPage(); await second.goto(address); await second.waitForFunction(() => 'motionLinkFixture' in globalThis);
	const newFence = await second.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionLinkFixture: Fixture }).motionLinkFixture; const owner = await fixture.owner();
		try { const entries = await owner.listOwners(); return await owner.claimOwnerWriteFence(entries[0]!.project.id); } finally { await owner.close(); }
	});
	const result = await page.evaluate(async (newFence) => {
		const state = (globalThis as unknown as { motionLinkTakeover: {
			owner: FramescaperCompositionLinkOwnerRepository; initial: NonNullable<Awaited<ReturnType<FramescaperCompositionLinkOwnerRepository['loadOwner']>>>;
			prepared: Awaited<ReturnType<FramescaperCompositionLinkOwnerRepository['prepareReceive']>>; history: FramescaperSuccessorHistory; fence: string;
		} }).motionLinkTakeover;
		const { owner, initial, prepared, history, fence } = state; let rejected = false;
		try { await prepared.commit({ project: history.present, history, expectedOwnerDigest: initial.ownerDigest, writeFence: fence }); }
		catch (error) { rejected = error instanceof Error && /fence/u.test(error.message); }
		const before = await owner.loadOwner(initial.project.id); const staleDelete = await owner.deleteOwner(initial.project.id, initial.ownerDigest, { writeFence: fence });
		const deleted = await owner.deleteOwner(initial.project.id, initial.ownerDigest, { writeFence: newFence });
		const after = await owner.loadOwner(initial.project.id); const catalog = await owner.listOwners(); await owner.close();
		return { rejected, sameIntent: before?.ownerDigest === initial.ownerDigest, staleDelete, deleted, after, catalog };
	}, newFence);
	await second.close(); expect(result).toEqual({ rejected: true, sameIntent: true, staleDelete: false, deleted: true, after: null, catalog: [] });
});


test('M10 real batch restores both links with one fenced owner/history publication and rolls back a second-link failure', async ({ page }) => {
	const result = await page.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionLinkFixture: Fixture }).motionLinkFixture;
		const { current, undone } = await fixture.pair(); const owner = await fixture.owner(); const writeFence = await owner.claimOwnerWriteFence(current.project.id);
		const transitions = undone.present.compositionLinks.map(link => ({ sourceId: link.sourceId, transition: { type: 'restore' as const, offer: { ...current.linkStates.find(entry => entry.sourceId === link.sourceId)!.state.accepted, revision: link.snapshot } } }));
		const prepared = await owner.prepareTransitions(current.project.id, transitions);
		const original = IDBObjectStore.prototype.put; let stateWrites = 0; let ownerWrites = 0;
		IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<typeof original>) {
			if (this.name === 'linkStates' && ++stateWrites === 2) throw new DOMException('Second link write failed', 'QuotaExceededError');
			return original.apply(this, args);
		};
		let failed = false;
		try { await prepared.commit({ expectedOwnerDigest: current.ownerDigest, project: undone.present, history: undone, writeFence }); }
		catch (error) { failed = error instanceof DOMException && error.name === 'QuotaExceededError'; } finally { IDBObjectStore.prototype.put = original; }
		const preserved = await owner.loadOwner(current.project.id); const retry = await owner.prepareTransitions(current.project.id, transitions);
		IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<typeof original>) { if (this.name === 'owners') ownerWrites++; return original.apply(this, args); };
		let accepted: FramescaperCompositionLinkOwnerReceipt;
		try { accepted = await retry.commit({ expectedOwnerDigest: current.ownerDigest, project: undone.present, history: undone, writeFence }); } finally { IDBObjectStore.prototype.put = original; }
		await owner.close(); const reopened = await fixture.owner(); const loaded = await reopened.loadOwner(current.project.id); await reopened.close();
		return { failed, stateWrites, preserved: JSON.stringify(preserved) === JSON.stringify(current), ownerWrites, same: JSON.stringify(loaded) === JSON.stringify(accepted),
			states: loaded?.linkStates.map(({ state }) => [state.accepted.revision.revision, state.pending?.revision.revision, state.paused]), history: JSON.stringify(loaded?.history) === JSON.stringify(undone) };
	});
	expect(result).toEqual({ failed: true, stateWrites: 2, preserved: true, ownerWrites: 1, same: true, states: [[1, 2, true], [1, 2, true]], history: true });
});
